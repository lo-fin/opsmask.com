import { describe, expect, it } from 'vitest';
import { extractXmlValues } from './xml-values';

describe('extractXmlValues', () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
  <!-- Configuration file -->
  <configuration env="prod" xmlns:ns="http://example.com/ns">
    <appSettings>
      <add key="ApiUrl" value="https://api.internal.net" />
      <add key="MaxRetries" value="3" />
    </appSettings>
    <connectionStrings>
      <add name="MainDb" connectionString="Server=pg.internal;Database=app;Password=s3cr3t&amp;123;" providerName="Npgsql" />
    </connectionStrings>
    <ns:servers>
      <ns:server id="s1">10.0.0.1</ns:server>
      <ns:server id="s2">10.0.0.2</ns:server>
    </ns:servers>
    <script><![CDATA[echo "hello <world>"]]></script>
  </configuration>`;

  it('extracts elements, attributes, CDATA, entities and <add key value> tags in dot mode', () => {
    const res = extractXmlValues(sampleXml);
    expect(res.items).toEqual([
      { key: 'configuration.@env', value: 'prod', kind: 'attribute' },
      { key: 'configuration.appSettings.ApiUrl', value: 'https://api.internal.net', kind: 'kv-tag' },
      { key: 'configuration.appSettings.MaxRetries', value: '3', kind: 'kv-tag' },
      { key: 'configuration.connectionStrings.MainDb', value: 'Server=pg.internal;Database=app;Password=s3cr3t&123;', kind: 'kv-tag' },
      { key: 'configuration.connectionStrings.MainDb.@providerName', value: 'Npgsql', kind: 'attribute' },
      { key: 'configuration.servers.server[0].@id', value: 's1', kind: 'attribute' },
      { key: 'configuration.servers.server[0]', value: '10.0.0.1', kind: 'element' },
      { key: 'configuration.servers.server[1].@id', value: 's2', kind: 'attribute' },
      { key: 'configuration.servers.server[1]', value: '10.0.0.2', kind: 'element' },
      { key: 'configuration.script', value: 'echo "hello <world>"', kind: 'element' },
    ]);
    expect(res.notes[0]).toMatch(/key\/value config tag/);
  });

  it('supports xpath and env modes and hiding attributes', () => {
    const xml = `<project><version>1.2.3</version><item type="a">one</item><item type="b">two</item></project>`;
    const xpathRes = extractXmlValues(xml, { mode: 'xpath', includeAttributes: false });
    expect(xpathRes.items).toEqual([
      { key: '/project/version', value: '1.2.3', kind: 'element' },
      { key: '/project/item[1]', value: 'one', kind: 'element' },
      { key: '/project/item[2]', value: 'two', kind: 'element' },
    ]);

    const envRes = extractXmlValues(xml, { mode: 'env', includeAttributes: true });
    expect(envRes.items).toEqual([
      { key: 'project__version', value: '1.2.3', kind: 'element' },
      { key: 'project__item__0__type', value: 'a', kind: 'attribute' },
      { key: 'project__item__0', value: 'one', kind: 'element' },
      { key: 'project__item__1__type', value: 'b', kind: 'attribute' },
      { key: 'project__item__1', value: 'two', kind: 'element' },
    ]);
  });

  it('throws on mismatched or unclosed XML tags', () => {
    expect(() => extractXmlValues('<root><a>1</b></root>')).toThrow(/Invalid XML/);
    expect(() => extractXmlValues('<root><a>1')).toThrow(/unclosed tag/);
  });
});
