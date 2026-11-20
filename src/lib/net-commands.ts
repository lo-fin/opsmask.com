// Builds network troubleshooting commands for Linux, macOS and Windows (PowerShell), with each flag explained.
export type OS = 'linux' | 'macos' | 'windows';
export type Field = { id: string; label: string; type?: 'text' | 'select' | 'check'; options?: string[]; value?: string | boolean; placeholder?: string };
export type Values = Record<string, string | boolean | undefined>;
export type Note = [string, string];
export type Built = { lines: string[]; explain: Note[]; warn?: string; alt?: Note[]; install?: Note[] };
export type Check = { label: string; fields: Field[]; build: (v: Values, os: OS) => Built };

export const OS_LABELS: Record<OS, string> = { linux: 'Linux', macos: 'macOS', windows: 'Windows (PowerShell)' };

// PowerShell treats a leading @ as splatting and commas as arrays, so they are quoted there.
const SAFE: Record<OS, RegExp> = { linux: /^[\w@%+=:,./-]+$/, macos: /^[\w@%+=:,./-]+$/, windows: /^[\w%+=:./-]+$/ };
export const quote = (s: string, os: OS) =>
  SAFE[os].test(s) ? s : os === 'windows' ? `'${s.replace(/'/g, "''")}'` : `'${s.replace(/'/g, `'\\''`)}'`;

const text = (v: Values, id: string) => (typeof v[id] === 'string' ? (v[id] as string).trim() : '');
// Quoted value, or an unquoted <placeholder> when the field is empty.
const arg = (v: Values, id: string, os: OS, placeholder = `<${id}>`) => (text(v, id) ? quote(text(v, id), os) : placeholder);
const win = (os: OS) => os === 'windows';
const nul = (os: OS) => (win(os) ? 'NUL' : '/dev/null');
const curl = (os: OS) => (win(os) ? 'curl.exe' : 'curl');

const HOST: Field = { id: 'host', label: 'Host or IP', value: 'example.com' };
const PORT: Field = { id: 'port', label: 'Port', value: '443' };

const CURL_EXE: Note = ['curl.exe', 'in Windows PowerShell, plain curl is an alias for Invoke-WebRequest; curl.exe is the real curl that ships with Windows'];

export const CHECKS: Record<string, Check> = {
  ping: {
    label: 'Is the host up? (ping)',
    fields: [HOST, { id: 'count', label: 'Count', value: '4' }],
    build: (v, os) => {
      const n = text(v, 'count') || '4';
      return {
        lines: [win(os) ? `Test-Connection ${arg(v, 'host', os)} -Count ${n}` : `ping -c ${n} ${arg(v, 'host', os)}`],
        explain: win(os)
          ? [['Test-Connection', 'PowerShell’s ping; ping.exe also works'], ['-Count', 'stop after this many replies']]
          : [['-c', 'stop after this many packets instead of running until Ctrl+C']],
        warn: 'Cloud networks (Azure NSGs, AWS security groups) and many firewalls block ICMP. No reply does not mean the host is down: test the port instead.',
      };
    },
  },
  port: {
    label: 'Is a TCP port open?',
    fields: [HOST, PORT, { id: 'timeout', label: 'Timeout (seconds)', value: '5' }],
    build: (v, os) => {
      const host = arg(v, 'host', os), port = arg(v, 'port', os, '<port>'), t = text(v, 'timeout') || '5';
      const results: Note[] = [
        ['refused', 'the host answered but nothing listens on that port, or a firewall actively rejects it'],
        ['timed out', 'packets are dropped on the way: firewall, NSG, security group or a missing route'],
      ];
      if (win(os)) {
        return {
          lines: [`Test-NetConnection ${host} -Port ${port}`],
          explain: [['TcpTestSucceeded', 'True means the TCP handshake completed'], ...results],
          alt: [[`curl.exe -v --connect-timeout ${t} telnet://${text(v, 'host') || '<host>'}:${text(v, 'port') || '<port>'}`, 'faster to fail than Test-NetConnection, which waits about 20 seconds on a dropped port']],
        };
      }
      const alt: Note[] = [[`curl -v --connect-timeout ${t} telnet://${text(v, 'host') || '<host>'}:${text(v, 'port') || '<port>'}`, 'when nc is not installed; Ctrl+C after “Connected”']];
      if (os === 'linux' && /^[\w.:-]+$/.test(text(v, 'host')) && /^\d+$/.test(text(v, 'port')))
        alt.push([`timeout ${t} bash -c '</dev/tcp/${text(v, 'host')}/${text(v, 'port')}' && echo open`, 'needs only bash, handy inside minimal containers']);
      return {
        lines: [`nc -zv ${os === 'macos' ? '-G' : '-w'} ${t} ${host} ${port}`],
        explain: [['-z', 'only connect, send no data'], ['-v', 'print whether it succeeded'], [os === 'macos' ? '-G' : '-w', 'give up after this many seconds'], ...results],
        alt,
      };
    },
  },
  trace: {
    label: 'Where do packets stop? (traceroute)',
    fields: [HOST, { id: 'mode', label: 'Probe', type: 'select', options: ['default', 'TCP to port'] }, PORT, { id: 'names', label: 'Resolve hop names', type: 'check' }],
    build: (v, os) => {
      const host = arg(v, 'host', os), port = arg(v, 'port', os, '<port>'), tcp = v.mode === 'TCP to port', names = !!v.names;
      const stars: Note = ['* * *', 'that hop did not answer, which many routers never do. It only matters if every hop after it is also * * *'];
      if (win(os)) {
        return {
          lines: [`tracert ${names ? '' : '-d '}${host}`],
          explain: [...(names ? [] : [['-d', 'do not look up hop names, much faster'] as Note]), ['tracert', 'uses ICMP'], stars],
          alt: [[`pathping ${names ? '' : '-n '}${host}`, 'traces, then measures packet loss at each hop; takes a few minutes']],
          warn: tcp ? `Windows has no built-in TCP traceroute. Firewalls that drop ICMP stop tracert early; check the port with Test-NetConnection ${host} -Port ${port}, or use WSL.` : undefined,
        };
      }
      const n = names ? '' : '-n ';
      const nNote: Note[] = names ? [] : [['-n', 'do not look up hop names, much faster']];
      const mtr: Note = [`${tcp ? 'sudo ' : ''}mtr -rwc 50 ${n}${tcp ? `--tcp -P ${port} ` : ''}${host}`, 'sends 50 probes and reports loss and latency per hop'];
      if (tcp && os === 'linux') {
        return {
          lines: [`sudo traceroute -T -p ${port} ${n}${host}`],
          explain: [['-T -p', 'TCP SYN probes to that port, so they pass firewalls that allow the service but drop ICMP and UDP; needs root'], ...nNote, stars],
          alt: [mtr],
        };
      }
      if (tcp) {
        return {
          lines: [mtr[0]],
          explain: [['--tcp -P', 'TCP SYN probes to that port, so they pass firewalls that drop ICMP and UDP'], ['-rwc 50', 'report mode, wide output, 50 probes'], ...nNote, stars],
          warn: 'macOS traceroute cannot probe a TCP port, so this uses mtr.',
        };
      }
      return {
        lines: [`traceroute ${n}${host}`],
        explain: [['traceroute', 'sends UDP probes with increasing TTL; add -I for ICMP if UDP is blocked'], ...nNote, stars],
        alt: [mtr],
      };
    },
  },
  dns: {
    label: 'Does the name resolve? (DNS)',
    fields: [
      { id: 'name', label: 'Name (or IP for PTR)', value: 'example.com' },
      { id: 'type', label: 'Record type', type: 'select', options: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'SRV', 'PTR'] },
      { id: 'server', label: 'DNS server', placeholder: 'system default' },
      { id: 'short', label: 'Answer only', type: 'check' },
      { id: 'trace', label: 'Follow from the root (+trace)', type: 'check' },
    ],
    build: (v, os) => {
      const name = arg(v, 'name', os, '<name>'), type = String(v.type || 'A'), server = text(v, 'server');
      const serverNote: Note[] = server ? [[win(os) ? '-Server' : '@server', 'ask this server instead of the one the system uses; compare with a public one like 1.1.1.1 to spot stale or split DNS']] : [];
      if (win(os)) {
        return {
          lines: [`Resolve-DnsName ${name} -Type ${type}${server ? ` -Server ${quote(server, os)}` : ''}`],
          explain: [['Resolve-DnsName', 'also checks the hosts file and the DNS cache; add -DnsOnly to skip them'], ...serverNote],
          alt: [[`nslookup -type=${type} ${name}${server ? ` ${quote(server, os)}` : ''}`, 'works in cmd and on older systems'], ['Clear-DnsClientCache', 'flush the local cache after fixing a record']],
          warn: v.trace ? 'Resolve-DnsName cannot trace from the root. Use dig +trace in WSL.' : undefined,
        };
      }
      const query = type === 'PTR' ? `-x ${name}` : `${name} ${type}`;
      const opts = [...(v.short ? ['+short'] : []), ...(v.trace ? ['+trace'] : [])];
      const nameText = text(v, 'name') || '<name>';
      return {
        lines: [['dig', ...(server && !v.trace ? [`@${quote(server, os)}`] : []), query, ...opts].join(' ')],
        explain: [
          ...(type === 'PTR' ? [['-x', 'reverse lookup: the name for an IP'] as Note] : []),
          ...serverNote,
          ...(v.short ? [['+short', 'print only the answer'] as Note] : []),
          ...(v.trace ? [['+trace', 'start at the root servers and follow each delegation, to find which zone gives the wrong answer'] as Note] : []),
          ['status:', 'NOERROR with no ANSWER means the name exists but has no record of this type; NXDOMAIN means the name does not exist; SERVFAIL usually means DNSSEC or an unreachable authoritative server'],
        ],
        alt: os === 'linux'
          ? [[`getent ahosts ${quote(nameText, os)}`, 'resolves the way applications do, including /etc/hosts and systemd-resolved; dig skips both']]
          : [[`dscacheutil -q host -a name ${quote(nameText, os)}`, 'resolves the way applications do, including /etc/hosts, VPN split DNS and /etc/resolver; dig skips them'], ['sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder', 'flush the DNS cache']],
        warn: server && v.trace ? '+trace ignores the DNS server; it always starts at the root.' : undefined,
      };
    },
  },
  http: {
    label: 'Why does an HTTP request fail? (curl)',
    fields: [
      { id: 'url', label: 'URL', value: 'https://example.com/' },
      { id: 'mode', label: 'Show', type: 'select', options: ['full conversation (-v)', 'timing of each step'] },
      { id: 'ip', label: 'Send to this IP instead', placeholder: 'from DNS' },
      { id: 'insecure', label: 'Ignore certificate errors (-k)', type: 'check' },
    ],
    build: (v, os) => {
      const url = text(v, 'url'), ip = text(v, 'ip'), timing = String(v.mode).startsWith('timing');
      const a = [curl(os)], e: Note[] = [];
      let warn: string | undefined;
      if (timing) {
        a.push('-s', '-o', nul(os), '-w', quote('dns %{time_namelookup}s\\nconnect %{time_connect}s\\ntls %{time_appconnect}s\\nfirst byte %{time_starttransfer}s\\ntotal %{time_total}s\\nstatus %{http_code}\\n', os));
        e.push(['-w', 'print cumulative seconds at each step: a big jump to dns, connect, tls or first byte shows where the time goes']);
      } else {
        a.push('-sv', '-o', nul(os));
        e.push(['-v', 'lines starting with * are curl’s own notes (DNS, connect, TLS), > is the request, < is the response'], ['-o ' + nul(os), 'discard the body so the headers stay readable']);
      }
      if (ip) {
        try {
          const u = new URL(url);
          const port = u.port || (u.protocol === 'http:' ? '80' : '443');
          a.push('--resolve', quote(`${u.hostname}:${port}:${ip}`, os));
          e.push(['--resolve', 'connect to that IP but keep the hostname for SNI and the Host header; tests one backend or a new server before changing DNS']);
        } catch { warn = 'Enter a full URL, such as https://example.com/, to use a fixed IP.'; }
      }
      if (v.insecure) { a.push('-k'); e.push(['-k', 'skip certificate checks; if this works and the normal request fails, the problem is the certificate']); }
      a.push(url ? quote(url, os) : '<url>');
      if (win(os)) e.push(CURL_EXE);
      return { lines: [a.join(' ')], explain: e, warn };
    },
  },
  tls: {
    label: 'Which certificate does the server send? (TLS)',
    fields: [HOST, PORT, { id: 'sni', label: 'Server name (SNI)', placeholder: 'same as host' }],
    build: (v, os) => {
      const h = text(v, 'host') || '<host>', p = text(v, 'port') || '443', sni = text(v, 'sni') || h;
      if (win(os)) {
        const target = sni === h ? `https://${h}:${p}/` : `https://${sni}:${p}/ --connect-to ${quote(`${sni}:${p}:${h}:${p}`, os)}`;
        return {
          lines: [`curl.exe -svI -o NUL ${target}`],
          explain: [['-v', 'shows the TLS handshake and certificate errors'], ['-I', 'HEAD request, headers only'], ...(sni !== h ? [['--connect-to', 'connect to the host but ask for the SNI name'] as Note] : []), CURL_EXE],
          warn: 'Windows has no openssl by default, and curl.exe prints only a summary of the certificate. For the full chain, run the Linux command in Git Bash or WSL.',
        };
      }
      const connect = `openssl s_client -connect ${quote(`${h}:${p}`, os)} -servername ${quote(sni, os)}`;
      return {
        lines: [`${connect} -showcerts </dev/null`],
        explain: [
          ['-servername', 'sends SNI. Without it, shared front ends (CDNs, load balancers, ingress controllers) return their default certificate'],
          ['-showcerts', 'print every certificate the server sends, to check the intermediate is included'],
          ['</dev/null', 'close the connection right after the handshake'],
          ['Verify return code', '0 (ok) at the end means the chain is trusted; anything else names the problem'],
        ],
        alt: [[`${connect} </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates`, 'just the names and expiry dates of the server certificate']],
      };
    },
  },
  listen: {
    label: 'What is listening on this machine?',
    fields: [{ id: 'port', label: 'Port', placeholder: 'all' }],
    build: (v, os) => {
      const port = text(v, 'port');
      const bind: Note = ['127.0.0.1', 'a service bound to 127.0.0.1 or ::1 is reachable only from this machine; 0.0.0.0 or [::] or * means every interface'];
      if (win(os)) {
        return {
          lines: [`Get-NetTCPConnection -State Listen${port ? ` -LocalPort ${quote(port, os)}` : ''} | Select-Object LocalAddress, LocalPort, OwningProcess, @{n='Process';e={(Get-Process -Id $_.OwningProcess).ProcessName}}`],
          explain: [['-State Listen', 'only listening sockets, not connections'], ['Process', 'looks up the process name from its PID'], bind],
          alt: [[`netstat -ano | findstr LISTENING`, 'works in cmd too; the last column is the PID']],
        };
      }
      if (os === 'macos') {
        return {
          lines: [`sudo lsof -nP -iTCP${port ? `:${quote(port, os)}` : ''} -sTCP:LISTEN`],
          explain: [['-nP', 'show numbers, not host and service names'], ['-sTCP:LISTEN', 'only listening sockets'], ['sudo', 'needed to see other users’ processes'], bind],
        };
      }
      return {
        lines: [`sudo ss -tulpn${port ? ` 'sport = :${port.replace(/'/g, '')}'` : ''}`],
        explain: [['-t -u', 'TCP and UDP'], ['-l', 'only listening sockets'], ['-p', 'show the process; needs sudo for other users’ processes'], ['-n', 'show numbers, not names'], bind],
      };
    },
  },
  kill: {
    label: 'Free a port (stop the process)',
    fields: [
      { id: 'port', label: 'Port or range', value: '8080', placeholder: 'every listening port' },
      { id: 'mine', label: 'Only my processes', type: 'check', value: true },
      { id: 'force', label: 'Force (kill -9)', type: 'check' },
    ],
    build: (v, os) => {
      const port = text(v, 'port'), mine = !!v.mine, force = !!v.force;
      if (port && !/^\d+(-\d+)?$/.test(port)) return { lines: [], explain: [], warn: 'Enter a port such as 8080, a range such as 3000-3999, or leave it empty for every port.' };
      const [from, to] = port.split('-');
      const warn = [
        ...(!port && !mine ? ['This stops every listening process, including sshd, DNS, Docker and databases. Keep “Only my processes” on unless you are sure.'] : []),
        ...(force ? [`${win(os) ? '-Force' : '-9'} gives the process no chance to clean up: unsaved data, lock files and half-written files stay behind. Try without it first.`] : []),
      ].join(' ') || undefined;
      const docker: Note = [`docker ps --filter publish=${from || '<port>'}`, 'if Docker publishes the port, stop the container instead of killing docker-proxy or Docker Desktop'];
      if (win(os)) {
        const ports = !port ? '' : to ? ` -LocalPort (${from}..${to})` : ` -LocalPort ${from}`;
        const select = `Get-NetTCPConnection -State Listen${ports} -ErrorAction SilentlyContinue`;
        return {
          lines: [
            '# 1. See what will be stopped',
            `${select} | Select-Object LocalPort, OwningProcess, @{n='Process';e={(Get-Process -Id $_.OwningProcess).ProcessName}}`,
            '# 2. Stop it',
            `${select} | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 4 } | ForEach-Object { Stop-Process -Id $_${force ? ' -Force' : ''} }`,
          ],
          explain: [
            ['-State Listen', 'only the server side, not programs connected to that port elsewhere'],
            ['$_ -gt 4', 'skip PID 0 and 4 (System), which own ports such as 445 and cannot be stopped'],
            ['Stop-Process', 'Windows has no graceful signal for this; the process ends immediately'],
            [mine ? 'only mine' : 'all users', mine ? 'run PowerShell without Administrator: Windows then refuses to stop other users’ and system processes' : 'run PowerShell as Administrator to stop processes of other users and services'],
            ...(force ? [['-Force', 'do not ask before stopping processes you do not own'] as Note] : []),
          ],
          alt: [
            ...(port && !to ? [[`netstat -ano | findstr :${from}`, 'in cmd: the last column is the PID; then taskkill /PID <pid>, adding /F if it refuses'] as Note] : []),
            docker,
          ],
          warn,
        };
      }
      const sel = `-iTCP${port ? `:${port}` : ''} -sTCP:LISTEN${mine ? ' -a -u "$USER"' : ''}`;
      const sudo = mine ? '' : 'sudo ';
      return {
        lines: [
          '# 1. See what will be stopped',
          `${sudo}lsof -nP ${sel}`,
          '# 2. Stop it',
          `${sudo}lsof -t ${sel} | ${os === 'linux' ? 'xargs -r' : 'xargs'} ${sudo}kill${force ? ' -9' : ''}`,
        ],
        explain: [
          ['-sTCP:LISTEN', 'only the server side. Without it, lsof also matches programs connected to that port on another machine, such as your browser'],
          ...(mine ? [['-a -u "$USER"', 'and owned by you, so system services are left alone'] as Note] : [['sudo', 'needed to see and stop other users’ processes'] as Note]),
          ['-t', 'print only PIDs, to pass to kill'],
          ...(os === 'linux' ? [['xargs -r', 'do nothing when no process matches'] as Note] : []),
          force ? ['kill -9', 'SIGKILL: ends the process at once'] : ['kill', 'SIGTERM: asks the process to shut down cleanly. If it is still there after a few seconds, add -9'],
        ],
        alt: [
          ...(os === 'linux' && port && !to ? [[`sudo fuser -k -${force ? 'KILL' : 'TERM'} ${from}/tcp`, 'one step, no lsof needed. fuser -k sends SIGKILL unless you name a signal'] as Note] : []),
          docker,
        ],
        warn,
      };
    },
  },
  route: {
    label: 'Which route and interface are used?',
    fields: [{ id: 'ip', label: 'Destination IP', placeholder: 'all routes' }],
    build: (v, os) => {
      const ip = text(v, 'ip');
      const vpn: Note = ['interface', 'if traffic for a VPN or private range leaves through Wi-Fi or the default gateway, the route for that range is missing'];
      if (win(os)) {
        return {
          lines: [ip ? `Find-NetRoute -RemoteIPAddress ${quote(ip, os)}` : 'Get-NetRoute -AddressFamily IPv4 | Sort-Object DestinationPrefix'],
          explain: [ip ? ['Find-NetRoute', 'the source address and route Windows picks for that destination'] : ['Get-NetRoute', 'the whole routing table'], vpn],
          alt: [['Get-NetIPConfiguration', 'addresses, gateway and DNS servers per interface']],
        };
      }
      if (os === 'macos') {
        return {
          lines: [ip ? `route -n get ${quote(ip, os)}` : 'netstat -rn -f inet'],
          explain: [ip ? ['route get', 'the gateway and interface used for that destination'] : ['netstat -rn', 'the IPv4 routing table, numeric'], vpn],
          alt: [['ifconfig', 'addresses per interface'], ['scutil --dns', 'DNS servers, including per-domain ones set by a VPN']],
        };
      }
      return {
        lines: [ip ? `ip route get ${quote(ip, os)}` : 'ip route'],
        explain: [ip ? ['ip route get', 'the gateway, interface and source address the kernel picks for that destination'] : ['ip route', 'the main routing table'], vpn],
        alt: [['ip -br addr', 'one line per interface with its addresses'], ['resolvectl status', 'DNS servers per interface on systemd-resolved']],
      };
    },
  },
  mtu: {
    label: 'Do large packets get through? (MTU)',
    fields: [HOST, { id: 'size', label: 'Payload bytes', value: '1472' }],
    build: (v, os) => {
      const host = arg(v, 'host', os), size = text(v, 'size') || '1472';
      const total = /^\d+$/.test(size) ? `${Number(size) + 28}` : `${size} + 28`;
      const flag: Record<OS, string> = { linux: `-M do -s ${size} -c 3`, macos: `-D -s ${size} -c 3`, windows: `-f -l ${size}` };
      return {
        lines: [`ping ${flag[os]} ${host}`],
        explain: [
          [os === 'linux' ? '-M do' : os === 'macos' ? '-D' : '-f', 'set Don’t Fragment, so a too-big packet fails instead of being split'],
          [os === 'windows' ? '-l' : '-s', `payload size; plus 28 bytes of headers that is a ${total}-byte packet`],
          ['lower until it works', 'the largest size that passes, plus 28, is the path MTU. VPNs, IPsec and overlay networks often bring it to around 1400'],
          ['symptom', 'small requests work but large ones or TLS handshakes hang: an MTU problem that ICMP blocking hides'],
        ],
        alt: win(os) ? [['ping.exe', 'this is the classic ping, which works in PowerShell; Test-Connection has no Don’t Fragment option on older versions']] : undefined,
      };
    },
  },
  capture: {
    label: 'Capture packets (tcpdump)',
    fields: [{ id: 'host', label: 'Host or IP', placeholder: 'any' }, { id: 'port', label: 'Port', placeholder: 'any' }, { id: 'count', label: 'Stop after N packets', value: '100' }, { id: 'file', label: 'Save to a .pcap file for Wireshark', type: 'check' }],
    build: (v, os) => {
      const host = text(v, 'host'), port = text(v, 'port'), count = text(v, 'count');
      const fileWarn = v.file ? 'Capture files contain everything sent unencrypted, including tokens and passwords. Do not share them publicly.' : undefined;
      if (win(os)) {
        const filter = [...(host ? ['-i', quote(host, os)] : []), ...(port ? ['-p', quote(port, os)] : [])];
        return {
          lines: [
            ...(filter.length ? [`pktmon filter add ${filter.join(' ')}`] : []),
            'pktmon start --capture --pkt-size 0',
            '# reproduce the problem, then:',
            'pktmon stop',
            v.file ? 'pktmon etl2pcap PktMon.etl --out capture.pcapng' : 'pktmon etl2txt PktMon.etl',
            ...(filter.length ? ['pktmon filter remove'] : []),
          ],
          explain: [['pktmon', 'built into Windows 10 and later; run PowerShell as Administrator'], ['filter add', 'without a filter it captures everything'], ['--pkt-size 0', 'keep whole packets, not only the first 128 bytes'], ['etl2pcap', 'convert to a file Wireshark opens']],
          warn: fileWarn,
        };
      }
      const expr = [...(host ? [`host ${host}`] : []), ...(port ? [`port ${port}`] : [])].join(' and ');
      const a = ['sudo', 'tcpdump', ...(os === 'linux' ? ['-i', 'any'] : []), '-nn', ...(count ? ['-c', count] : []), ...(v.file ? ['-w', 'capture.pcap'] : []), ...(expr ? [quote(expr, os)] : [])];
      return {
        lines: [a.join(' ')],
        explain: [
          os === 'linux' ? ['-i any', 'every interface'] : ['-i', 'without it, tcpdump uses the first interface (usually en0); add -i utun0 or similar for a VPN'],
          ['-nn', 'do not resolve hosts or ports, faster and clearer'],
          ...(count ? [['-c', 'stop after that many packets'] as Note] : []),
          ...(v.file ? [['-w', 'write raw packets to a file for Wireshark instead of printing them'] as Note] : []),
          ['Flags [S] / [R]', 'a SYN with no SYN-ACK back means the packet is dropped; [R] means the other side reset the connection'],
        ],
        warn: fileWarn,
      };
    },
  },
};

type Pm = 'apt' | 'dnf' | 'apk' | 'brew';
const PM: [Pm, string, string][] = [
  ['apt', 'Debian / Ubuntu', 'sudo apt-get update && sudo apt-get install -y'],
  ['dnf', 'RHEL / Fedora', 'sudo dnf install -y'],
  ['apk', 'Alpine', 'apk add'],
  ['brew', 'macOS (Homebrew)', 'brew install'],
];
const IPROUTE = { apt: 'iproute2', dnf: 'iproute', apk: 'iproute2' };
// Packages for commands that minimal Linux images often lack. macOS ships all of them except mtr; Windows ships everything used here.
const PACKAGES: Record<string, Partial<Record<Pm, string>>> = {
  ping: { apt: 'iputils-ping', dnf: 'iputils', apk: 'iputils' },
  nc: { apt: 'netcat-openbsd', dnf: 'nmap-ncat', apk: 'netcat-openbsd' },
  traceroute: { apt: 'traceroute', dnf: 'traceroute' },
  mtr: { apt: 'mtr-tiny', dnf: 'mtr', apk: 'mtr', brew: 'mtr' },
  dig: { apt: 'dnsutils', dnf: 'bind-utils', apk: 'bind-tools' },
  curl: { apt: 'curl', dnf: 'curl', apk: 'curl' },
  openssl: { apt: 'openssl', dnf: 'openssl', apk: 'openssl' },
  ss: IPROUTE,
  ip: IPROUTE,
  tcpdump: { apt: 'tcpdump', dnf: 'tcpdump', apk: 'tcpdump' },
  lsof: { apt: 'lsof', dnf: 'lsof', apk: 'lsof' },
  fuser: { apt: 'psmisc', dnf: 'psmisc', apk: 'psmisc' },
};

// The program each pipeline segment runs, ignoring sudo.
export function commandsIn(line: string): string[] {
  if (line.trimStart().startsWith('#')) return [];
  return line.split(/\|\||&&|\||;/).map((seg) => seg.trim().split(/\s+/).filter((w) => w !== 'sudo')[0]).filter(Boolean);
}

export function installCommands(lines: string[], os: OS): Note[] {
  if (win(os)) return [];
  const tools = [...new Set(lines.flatMap(commandsIn))].filter((t) => PACKAGES[t]);
  return PM.filter(([pm]) => (pm === 'brew') === (os === 'macos')).flatMap(([pm, label, install]) => {
    const pkgs = [...new Set(tools.map((t) => PACKAGES[t][pm]).filter(Boolean))];
    return pkgs.length ? [[`${install} ${pkgs.join(' ')}`, label] as Note] : [];
  });
}

export function build(check: string, os: OS, v: Values): Built {
  const c = CHECKS[check];
  if (!c) throw new Error(`Unknown check: ${check}`);
  const out = c.build(v, os);
  const install = installCommands([...out.lines, ...(out.alt ?? []).map((a) => a[0])], os);
  return install.length ? { ...out, install } : out;
}
