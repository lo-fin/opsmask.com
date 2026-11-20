import { describe, expect, it } from 'vitest';
import { build, CHECKS, commandsIn, quote, type OS, type Values } from './net-commands';

const cmd = (check: string, os: OS, v: Values) => build(check, os, v).lines.join('\n');
const OSES: OS[] = ['linux', 'macos', 'windows'];

describe('quote', () => {
  it('leaves safe words alone and quotes the rest per shell', () => {
    expect(quote('example.com', 'linux')).toBe('example.com');
    expect(quote("it's here", 'linux')).toBe(`'it'\\''s here'`);
    expect(quote("it's here", 'windows')).toBe(`'it''s here'`);
  });

  it('quotes PowerShell splatting and array syntax', () => {
    expect(quote('@8.8.8.8', 'windows')).toBe(`'@8.8.8.8'`);
    expect(quote('a,b', 'windows')).toBe(`'a,b'`);
    expect(quote('a,b', 'linux')).toBe('a,b');
  });
});

describe('build', () => {
  it('builds something for every check on every OS with default values', () => {
    for (const [id, c] of Object.entries(CHECKS)) {
      const v = Object.fromEntries(c.fields.map((f) => [f.id, f.value ?? (f.type === 'select' ? f.options![0] : f.type === 'check' ? false : '')]));
      for (const os of OSES) {
        const r = build(id, os, v);
        expect(r.lines.length, `${id} on ${os}`).toBeGreaterThan(0);
        expect(r.lines.join(''), `${id} on ${os}`).not.toMatch(/undefined|\[object/);
      }
    }
  });

  it('uses the right ping flags per OS', () => {
    expect(cmd('ping', 'linux', { host: 'db', count: '3' })).toBe('ping -c 3 db');
    expect(cmd('ping', 'windows', { host: 'db', count: '3' })).toBe('Test-Connection db -Count 3');
  });

  it('uses -G for the connect timeout of macOS nc', () => {
    expect(cmd('port', 'linux', { host: 'db', port: '5432', timeout: '3' })).toBe('nc -zv -w 3 db 5432');
    expect(cmd('port', 'macos', { host: 'db', port: '5432', timeout: '3' })).toBe('nc -zv -G 3 db 5432');
    expect(cmd('port', 'windows', { host: 'db', port: '5432' })).toBe('Test-NetConnection db -Port 5432');
  });

  it('offers the bash /dev/tcp fallback only for safe input', () => {
    expect(build('port', 'linux', { host: 'db', port: '5432' }).alt!.map((a) => a[0]).join()).toMatch(/dev\/tcp\/db\/5432/);
    expect(build('port', 'linux', { host: 'db;id', port: '5432' }).alt!.map((a) => a[0]).join()).not.toMatch(/dev\/tcp/);
  });

  it('switches traceroute to TCP probes', () => {
    expect(cmd('trace', 'linux', { host: 'db', mode: 'TCP to port', port: '443' })).toBe('sudo traceroute -T -p 443 -n db');
    expect(cmd('trace', 'macos', { host: 'db', mode: 'TCP to port', port: '443' })).toBe('sudo mtr -rwc 50 -n --tcp -P 443 db');
    expect(build('trace', 'windows', { host: 'db', mode: 'TCP to port', port: '443' }).warn).toMatch(/no built-in TCP traceroute/);
    expect(cmd('trace', 'windows', { host: 'db', names: true })).toBe('tracert db');
  });

  it('builds dig and Resolve-DnsName queries', () => {
    expect(cmd('dns', 'linux', { name: 'example.com', type: 'MX', server: '1.1.1.1', short: true })).toBe('dig @1.1.1.1 example.com MX +short');
    expect(cmd('dns', 'linux', { name: '10.0.0.4', type: 'PTR' })).toBe('dig -x 10.0.0.4');
    expect(cmd('dns', 'windows', { name: 'example.com', type: 'TXT', server: '1.1.1.1' })).toBe('Resolve-DnsName example.com -Type TXT -Server 1.1.1.1');
    const traced = build('dns', 'linux', { name: 'example.com', type: 'A', server: '1.1.1.1', trace: true });
    expect(traced.lines[0]).toBe('dig example.com A +trace');
    expect(traced.warn).toMatch(/ignores the DNS server/);
  });

  it('pins curl to an IP with --resolve and uses curl.exe on Windows', () => {
    expect(cmd('http', 'linux', { url: 'https://api.example.com/health', mode: 'full conversation (-v)', ip: '10.0.0.4' }))
      .toBe('curl -sv -o /dev/null --resolve api.example.com:443:10.0.0.4 https://api.example.com/health');
    expect(cmd('http', 'windows', { url: 'http://example.com:8080/', mode: 'full conversation (-v)', ip: '10.0.0.4' }))
      .toBe('curl.exe -sv -o NUL --resolve example.com:8080:10.0.0.4 http://example.com:8080/');
    expect(build('http', 'linux', { url: 'example.com', ip: '10.0.0.4' }).warn).toMatch(/full URL/);
  });

  it('quotes the curl timing format so the shell leaves it alone', () => {
    expect(cmd('http', 'linux', { url: 'https://example.com/', mode: 'timing of each step' })).toMatch(/-w 'dns %\{time_namelookup\}s\\n.*' https:\/\/example.com\/$/);
  });

  it('sends SNI with openssl and curl', () => {
    expect(cmd('tls', 'linux', { host: '10.0.0.4', port: '443', sni: 'api.example.com' }))
      .toBe('openssl s_client -connect 10.0.0.4:443 -servername api.example.com -showcerts </dev/null');
    expect(cmd('tls', 'windows', { host: '10.0.0.4', port: '443', sni: 'api.example.com' }))
      .toBe('curl.exe -svI -o NUL https://api.example.com:443/ --connect-to api.example.com:443:10.0.0.4:443');
  });

  it('filters listening sockets by port', () => {
    expect(cmd('listen', 'linux', { port: '8080' })).toBe(`sudo ss -tulpn 'sport = :8080'`);
    expect(cmd('listen', 'macos', { port: '8080' })).toBe('sudo lsof -nP -iTCP:8080 -sTCP:LISTEN');
    expect(cmd('listen', 'linux', {})).toBe('sudo ss -tulpn');
  });

  it('shows the route for one destination or the whole table', () => {
    expect(cmd('route', 'linux', { ip: '10.1.2.3' })).toBe('ip route get 10.1.2.3');
    expect(cmd('route', 'macos', { ip: '10.1.2.3' })).toBe('route -n get 10.1.2.3');
    expect(cmd('route', 'windows', { ip: '10.1.2.3' })).toBe('Find-NetRoute -RemoteIPAddress 10.1.2.3');
    expect(cmd('route', 'linux', {})).toBe('ip route');
  });

  it('sets Don’t Fragment for the MTU test and adds 28 header bytes', () => {
    expect(cmd('mtu', 'linux', { host: 'db', size: '1372' })).toBe('ping -M do -s 1372 -c 3 db');
    expect(cmd('mtu', 'macos', { host: 'db', size: '1372' })).toBe('ping -D -s 1372 -c 3 db');
    expect(cmd('mtu', 'windows', { host: 'db', size: '1372' })).toBe('ping -f -l 1372 db');
    expect(build('mtu', 'linux', { host: 'db', size: '1372' }).explain.map((e) => e[1]).join()).toMatch(/1400-byte packet/);
  });

  it('builds a quoted tcpdump filter and a pktmon session', () => {
    expect(cmd('capture', 'linux', { host: '10.0.0.4', port: '443', count: '100', file: true }))
      .toBe(`sudo tcpdump -i any -nn -c 100 -w capture.pcap 'host 10.0.0.4 and port 443'`);
    expect(build('capture', 'linux', { file: true }).warn).toMatch(/Do not share/);
    const win = build('capture', 'windows', { host: '10.0.0.4', port: '443', file: true }).lines;
    expect(win[0]).toBe('pktmon filter add -i 10.0.0.4 -p 443');
    expect(win).toContain('pktmon etl2pcap PktMon.etl --out capture.pcapng');
    expect(win.at(-1)).toBe('pktmon filter remove');
  });

  it('frees a port with lsof, only the listening side and only my processes by default', () => {
    const r = build('kill', 'linux', { port: '8080', mine: true });
    expect(r.lines).toEqual([
      '# 1. See what will be stopped',
      'lsof -nP -iTCP:8080 -sTCP:LISTEN -a -u "$USER"',
      '# 2. Stop it',
      'lsof -t -iTCP:8080 -sTCP:LISTEN -a -u "$USER" | xargs -r kill',
    ]);
    expect(r.alt![0][0]).toBe('sudo fuser -k -TERM 8080/tcp');
    expect(r.warn).toBeUndefined();
    expect(r.install![0][0]).toBe('sudo apt-get update && sudo apt-get install -y lsof psmisc');
  });

  it('uses sudo for other users, a range, and warns about -9 and every port', () => {
    expect(cmd('kill', 'macos', { port: '3000-3999', force: true })).toMatch(/^sudo lsof -t -iTCP:3000-3999 -sTCP:LISTEN \| xargs sudo kill -9$/m);
    expect(build('kill', 'macos', { port: '3000-3999', force: true }).warn).toMatch(/no chance to clean up/);
    expect(build('kill', 'linux', { port: '', mine: false }).warn).toMatch(/every listening process/);
    expect(build('kill', 'linux', { port: '', mine: true }).lines[1]).toBe('lsof -nP -iTCP -sTCP:LISTEN -a -u "$USER"');
    expect(build('kill', 'linux', { port: '80; rm -rf /' }).lines).toEqual([]);
  });

  it('frees a port on Windows, skipping the System process', () => {
    const r = build('kill', 'windows', { port: '3000-3010', mine: true });
    expect(r.lines[3]).toBe('Get-NetTCPConnection -State Listen -LocalPort (3000..3010) -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 4 } | ForEach-Object { Stop-Process -Id $_ }');
    expect(build('kill', 'windows', { port: '8080', force: true }).lines[3]).toMatch(/-LocalPort 8080 .*Stop-Process -Id \$_ -Force \}$/);
  });

  it('finds the programs in a pipeline, ignoring sudo and comments', () => {
    expect(commandsIn('openssl s_client -connect a:443 </dev/null 2>/dev/null | openssl x509 -noout')).toEqual(['openssl', 'openssl']);
    expect(commandsIn('sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder')).toEqual(['dscacheutil', 'killall']);
    expect(commandsIn('# reproduce the problem, then:')).toEqual([]);
  });

  it('shows install commands for the main and alternative tools, per package manager', () => {
    const r = build('dns', 'linux', { name: 'example.com', type: 'A' });
    expect(r.install).toEqual([
      ['sudo apt-get update && sudo apt-get install -y dnsutils', 'Debian / Ubuntu'],
      ['sudo dnf install -y bind-utils', 'RHEL / Fedora'],
      ['apk add bind-tools', 'Alpine'],
    ]);
    expect(build('port', 'linux', { host: 'db', port: '5432' }).install![0][0]).toBe('sudo apt-get update && sudo apt-get install -y netcat-openbsd curl');
  });

  it('skips package managers that have no package for the tool', () => {
    expect(build('trace', 'linux', { host: 'db', mode: 'default' }).install!.find((i) => i[1] === 'Alpine')![0]).toBe('apk add mtr');
  });

  it('only suggests Homebrew on macOS for tools macOS lacks, and nothing on Windows', () => {
    expect(build('trace', 'macos', { host: 'db', mode: 'TCP to port', port: '443' }).install).toEqual([['brew install mtr', 'macOS (Homebrew)']]);
    expect(build('dns', 'macos', { name: 'example.com', type: 'A' }).install).toBeUndefined();
    expect(build('trace', 'windows', { host: 'db' }).install).toBeUndefined();
  });

  it('rejects unknown checks', () => {
    expect(() => build('nope', 'linux', {})).toThrow(/Unknown check/);
  });
});
