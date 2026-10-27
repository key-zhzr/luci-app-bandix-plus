'use strict';
'require view';
'require form';
'require ui';
'require uci';
'require rpc';
'require poll';
'require dom';
'require tools.widgets as widgets';

var callRestartService = rpc.declare({ object: 'luci.bandix_plus', method: 'restartService', expect: {} });
var callGetVersion = rpc.declare({ object: 'luci.bandix_plus', method: 'getVersion', expect: {} });
var callCheckUpdate = rpc.declare({ object: 'luci.bandix_plus', method: 'checkUpdate', expect: {} });
var callGetBpfMaps = rpc.declare({ object: 'luci.bandix_plus', method: 'getBpfMaps', expect: {} });

function bpfStatusContent(result) {
	if (!result || !result.ok || !result.data)
		return E('p', { 'class': 'alert-message warning' }, _('BPF map status unavailable'));
	var status = result.data;
	var rows = [ E('tr', { 'class': 'tr table-titles' }, [
		E('th', { 'class': 'th' }, _('BPF map')),
		E('th', { 'class': 'th' }, _('Entries / capacity'))
	]) ];
	(status.maps || []).forEach(function (map) {
		rows.push(E('tr', { 'class': 'tr' + (map.near_capacity ? ' warning' : '') }, [
			E('td', { 'class': 'td' }, map.name),
			E('td', { 'class': 'td' }, String(map.entries) + ' / ' + String(map.max_entries) +
				(map.near_capacity ? ' — ' + _('Near capacity') : ''))
		]));
	});
	return E('div', {}, [
		E('p', {}, _('Loaded BPF capacity') + ': ' + String(status.configured_max_entries)),
		E('table', { 'class': 'table' }, rows),
		E('p', { 'class': 'cbi-value-description' }, _('Counts are approximate and refresh every 10 seconds. Capacity is per map, not a device count.'))
	]);
}

return view.extend({
	load: function () {
		var self = this;
		return Promise.all([
			uci.load('bandix_plus'),
			uci.load('network'),
			callGetVersion().then(function (result) {
				self.versionInfo = result || {};
				return result;
			}).catch(function () {
				self.versionInfo = {
					luci_app_version: _('Unknown'),
					bandix_plus_version: _('Unknown')
				};
				return null;
			}),
			callGetBpfMaps().then(function (result) { self.bpfMaps = result; }).catch(function () { self.bpfMaps = null; })
		]);
	},

	render: function () {
		var m, s, o;
		var self = this;
		var versionInfo = this.versionInfo || {};

		if (!uci.get('bandix_plus', 'general')) {
			uci.add('bandix_plus', 'bandix_plus', 'general');
		}

		m = new form.Map('bandix_plus', _('Bandix Plus'), _('Runtime options for openwrt-bandix-plus service.'));

		s = m.section(form.NamedSection, 'general', 'bandix_plus', _('General'));
		s.addremove = false;
		s.description = _('This page edits /etc/config/bandix_plus general options.');

		o = s.option(form.Flag, 'enable_traffic', _('Enable traffic collection'), _('When disabled, bandix-plus service will not start.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'bpf_map_max_entries', _('BPF map capacity'), _('Maximum entries in each of the seven BPF maps. 4096 is suitable for small LANs; 65536 preserves the previous capacity. Applying changes restarts Bandix Plus.'));
		[ '1024', '4096', '8192', '16384', '65536' ].forEach(function (value) { o.value(value, value); });
		o.datatype = 'and(uinteger,range(1024,65536))';
		o.default = '65536';
		o.rmempty = false;

		var bpfStatusNode = E('div', {}, [ bpfStatusContent(this.bpfMaps) ]);
		o = s.option(form.DummyValue, '_bpf_runtime', _('Runtime BPF maps'));
		o.renderWidget = function () { return bpfStatusNode; };
		poll.add(function () {
			return callGetBpfMaps().then(function (result) {
				self.bpfMaps = result;
				dom.content(bpfStatusNode, bpfStatusContent(result));
			}).catch(function () { dom.content(bpfStatusNode, bpfStatusContent(null)); });
		}, 10);

		o = s.option(widgets.DeviceSelect, 'iface', _('Interface to monitor'), _('Select one or more interfaces to monitor.'));
		o.multiple = true;
		o.noaliases = true;
		o.nobridges = false;
		o.nocreate = true;
		o.rmempty = false;

		o = s.option(form.ListValue, 'default_iface', _('Default interface'), _('Interface selected by default on the Status page. Leave it as Auto to use the first monitored interface.'));
		o.value('auto', _('Auto (first monitored interface)'));
		var monitoredIfaces = uci.get('bandix_plus', 'general', 'iface');
		if (typeof monitoredIfaces === 'string')
			monitoredIfaces = [ monitoredIfaces ];
		if (!Array.isArray(monitoredIfaces))
			monitoredIfaces = [];
		for (var mi = 0; mi < monitoredIfaces.length; mi++) {
			if (monitoredIfaces[mi])
				o.value(monitoredIfaces[mi], monitoredIfaces[mi]);
		}
		var currentDefaultIface = uci.get('bandix_plus', 'general', 'default_iface');
		if (currentDefaultIface && currentDefaultIface !== 'auto' && monitoredIfaces.indexOf(currentDefaultIface) === -1)
			o.value(currentDefaultIface, currentDefaultIface);
		o.default = 'auto';
		o.rmempty = false;

		o = s.option(form.ListValue, 'log_level', _('Log level'));
		o.value('trace', 'trace');
		o.value('debug', 'debug');
		o.value('info', 'info');
		o.value('warn', 'warn');
		o.value('error', 'error');
		o.default = 'info';
		o.rmempty = false;

		o = s.option(form.ListValue, 'tc_backend', _('TC backend'), _('Select TC attach backend. Recommendation: use auto by default; tcx is preferred on kernel >= 6.6; netlink is safer on older kernels.'));
		o.value('auto', 'auto');
		o.value('tcx', 'tcx');
		o.value('netlink', 'netlink');
		o.default = 'auto';
		o.rmempty = false;

		o = s.option(form.ListValue, 'tc_order', _('TC order'));
		o.value('first', 'first');
		o.value('default', 'default');
		o.value('last', 'last');
		o.value('before', 'before');
		o.value('after', 'after');
		o.default = 'default';
		o.rmempty = false;
		o.depends('tc_backend', 'tcx');

		o = s.option(form.Value, 'netlink_priority', _('Netlink priority'), _('Only used when backend is netlink. Range: 0..65535 (0 means default).'));
		o.datatype = 'range(0,65535)';
		o.default = '0';
		o.placeholder = '0';
		o.rmempty = false;
		o.depends('tc_backend', 'netlink');

		o = s.option(form.Value, 'tcx_anchor_ingress_id', _('TCX ingress anchor program id'), _('Used when tc_order is before/after. Must be a valid ingress program id on the same interface.'));
		o.datatype = 'uinteger';
		o.rmempty = true;
		o.depends({ tc_backend: 'tcx', tc_order: 'before' });
		o.depends({ tc_backend: 'tcx', tc_order: 'after' });

		o = s.option(form.Value, 'tcx_anchor_egress_id', _('TCX egress anchor program id'), _('Used when tc_order is before/after. Must be a valid egress program id on the same interface.'));
		o.datatype = 'uinteger';
		o.rmempty = true;
		o.depends({ tc_backend: 'tcx', tc_order: 'before' });
		o.depends({ tc_backend: 'tcx', tc_order: 'after' });

		o = s.option(form.Flag, 'traffic_enable_storage', _('Enable traffic persistence storage'), _('Persist traffic history data to disk. Disabled by default.'));
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'traffic_retention_days', _('Traffic retention days'), _('Number of days to keep persisted hourly traffic data. Set 0 to keep forever.'));
		o.datatype = 'uinteger';
		o.placeholder = '366';
		o.default = '366';
		o.rmempty = false;
		o.depends('traffic_enable_storage', '1');

		o = s.option(form.Value, 'host', _('Host'));
		o.placeholder = '127.0.0.1';
		o.default = '127.0.0.1';
		o.rmempty = false;

		o = s.option(form.Value, 'port', _('Port'));
		o.datatype = 'port';
		o.placeholder = '8787';
		o.default = '8787';
		o.rmempty = false;

		o = s.option(form.Value, 'data_dir', _('Data directory'));
		o.placeholder = '/usr/share/bandix-plus';
		o.default = '/usr/share/bandix-plus';
		o.rmempty = false;

		o = s.option(form.DummyValue, 'version', _('Version'));
		o.cfgvalue = function () {
			var luciVersion = versionInfo.luci_app_version || _('Unknown');
			var bandixPlusVersion = versionInfo.bandix_plus_version || versionInfo.bandix_plus_pkg || _('Unknown');
			return 'luci-app-bandix-plus: ' + luciVersion + ' / bandix-plus: ' + bandixPlusVersion;
		};

		o = s.option(form.Button, 'check_update', _('Check for Updates'));
		o.inputtitle = _('Check for Updates');
		o.inputstyle = 'apply';
		o.onclick = function () {
			var button = this;
			var originalTitle = button.inputtitle;
			button.inputtitle = _('Checking...');
			button.disabled = true;

			return callCheckUpdate().then(function (result) {
				button.inputtitle = originalTitle;
				button.disabled = false;

				if (!result) {
					ui.addNotification(null, E('p', _('Failed to check for updates')), 'error');
					return;
				}

				var messages = [];
				var hasUpdate = false;
				var hasError = false;

				if (result.luci_error) {
					hasError = true;
					messages.push(E('p', { 'class': 'alert-message error' }, _('Failed to check LuCI App updates')));
				}
				else if (result.luci_has_update === true || result.luci_has_update === 1 || result.luci_has_update === '1') {
					hasUpdate = true;
					messages.push(E('p', { 'style': 'font-weight: 600;' },
						_('LuCI App has update: ') + result.current_luci_version + ' → ' + result.latest_luci_version));
					if (result.luci_release_body) {
						messages.push(E('div', {
							'style': 'white-space: pre-wrap; max-height: 240px; overflow-y: auto; padding: 10px; margin: 8px 0; background: rgba(0,0,0,0.05); border-radius: 4px;'
						}, result.luci_release_body));
					}
					if (result.luci_update_url) {
						messages.push(E('a', {
							'href': result.luci_update_url,
							'target': '_blank',
							'rel': 'noopener noreferrer'
						}, _('Manual Download')));
					}
				}
				else {
					messages.push(E('p', {}, _('LuCI App is up to date: ') +
						(result.current_luci_version || result.latest_luci_version || _('Unknown'))));
				}

				if (result.bandix_plus_error) {
					hasError = true;
					messages.push(E('p', { 'class': 'alert-message error' }, _('Failed to check Bandix Plus updates')));
				}
				else if (result.bandix_plus_has_update === true || result.bandix_plus_has_update === 1 || result.bandix_plus_has_update === '1') {
					hasUpdate = true;
					messages.push(E('p', { 'style': 'font-weight: 600; margin-top: 16px;' },
						_('Bandix Plus has update: ') + result.current_bandix_plus_version + ' → ' + result.latest_bandix_plus_version));
					if (result.bandix_plus_release_body) {
						messages.push(E('div', {
							'style': 'white-space: pre-wrap; max-height: 240px; overflow-y: auto; padding: 10px; margin: 8px 0; background: rgba(0,0,0,0.05); border-radius: 4px;'
						}, result.bandix_plus_release_body));
					}
					if (result.bandix_plus_update_url) {
						messages.push(E('a', {
							'href': result.bandix_plus_update_url,
							'target': '_blank',
							'rel': 'noopener noreferrer'
						}, _('Manual Download')));
					}
				}
				else {
					messages.push(E('p', {}, _('Bandix Plus is up to date: ') +
						(result.current_bandix_plus_version || result.latest_bandix_plus_version || _('Unknown'))));
				}

				messages.push(E('div', { 'class': 'right', 'style': 'margin-top: 16px;' }, [
					E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close'))
				]));

				var title = hasUpdate ? _('Updates Available') :
					(hasError ? _('Update Check Failed') : _('No Updates Available'));
				ui.showModal(title, messages);
			}).catch(function (err) {
				button.inputtitle = originalTitle;
				button.disabled = false;
				ui.addNotification(null, E('p', _('Failed to check for updates') + ': ' + err.message), 'error');
			});
		};

		o = s.option(form.Button, 'restart_service', _('Restart Service'));
		o.inputtitle = _('Restart Bandix Plus Service');
		o.inputstyle = 'apply';
		o.onclick = function () {
			return ui.showModal(_('Restart Service'), [
				E('p', _('Are you sure you want to restart the Bandix Plus service?')),
				E('div', { 'class': 'right' }, [
					E('button', {
						'class': 'btn',
						'click': ui.hideModal
					}, _('Cancel')),
					' ',
					E('button', {
						'class': 'btn cbi-button-action',
						'click': function () {
							ui.hideModal();
							return callRestartService().then(function (result) {
								if (result && result.success === false) {
									ui.addNotification(null, E('p', _('Failed to restart service: ') + (result.error || _('Unknown'))), 'error');
								}
							}).catch(function (err) {
								ui.addNotification(null, E('p', _('Failed to restart service: ') + err.message), 'error');
							});
						}
					}, _('Confirm'))
				])
			]);
		};

		o = s.option(form.Button, 'feedback_info', _('Feedback'));
		o.inputtitle = _('Feedback');
		o.inputstyle = 'link';
		o.onclick = function () {
			window.open('https://github.com/timsaya', '_blank');
			return false;
		};

		return m.render();
	}
});
