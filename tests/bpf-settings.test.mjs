import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../luci-app-bandix-plus/htdocs/luci-static/resources/view/bandix_plus/settings.js', import.meta.url), 'utf8');

test('BPF settings show saved versus loaded capacity and refresh runtime usage', async () => {
    const options = [];
    const polls = [];
    let capacity = 4096;
    const element = (tag, attrs, children) => ({ tag, attrs, children });
    const result = () => ({ ok: true, data: {
        configured_max_entries: capacity,
        maps: [{ name: 'DEVICE_TRAFFIC_STATS', entries: 167, max_entries: capacity, near_capacity: false }]
    } });
    class FormMap {
        section() { return { option(type, name, label, description) {
            const option = { name, label, description, choices: [], value(v) { this.choices.push(v); }, depends() {} };
            options.push(option);
            return option;
        } }; }
        render() { return options; }
    }
    const methods = runInNewContext(`(function () { ${source}\n})()`, {
        E: element, _: value => value,
        view: { extend: value => value },
        form: { Map: FormMap }, widgets: {},
        uci: { load: () => Promise.resolve(), get: (_config, _section, name) => name === 'bpf_map_max_entries' ? '8192' : null, add() {} },
        rpc: { declare: ({ method }) => () => Promise.resolve(method === 'getBpfMaps' ? result() : {}) },
        poll: { add: (fn, interval) => polls.push({ fn, interval }) },
        dom: { content: (node, value) => { node.children = value; } }
    });
    const view = Object.assign({}, methods);
    await view.load();
    view.render();
    const setting = options.find(option => option.name === 'bpf_map_max_entries');
    assert.equal(setting.datatype, 'and(uinteger,range(1024,65536))');
    assert.equal(setting.default, '65536');
    assert.ok(setting.choices.includes('4096'));
    const runtime = options.find(option => option.name === '_bpf_runtime').renderWidget();
    assert.match(JSON.stringify(runtime), /167 \/ 4096/);
    assert.equal(polls.length, 1);
    assert.equal(polls[0].interval, 10);
    capacity = 8192;
    await polls[0].fn();
    assert.match(JSON.stringify(runtime), /167 \/ 8192/);
});
