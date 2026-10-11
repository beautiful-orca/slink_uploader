/**
 * Slink Uploader admin settings: dynamic context-menu entry rows and
 * save via fetch. Loaded from Settings\Admin::getForm(); must not be
 * inlined in the template (Nextcloud CSP blocks inline scripts).
 */
(function () {
	'use strict';

	function addEntryRow(entriesBody, name, params) {
		var tr = document.createElement('tr');
		tr.className = 'slink-entry-row';
		tr.innerHTML = '<td><input type="text" class="entry-name" autocomplete="off" /></td>'
			+ '<td><input type="text" class="entry-params" autocomplete="off" style="min-width: 220px;" /></td>'
			+ '<td><button type="button" class="slink-remove-entry button"></button></td>';
		tr.querySelector('.entry-name').value = name;
		tr.querySelector('.entry-params').value = params;
		tr.querySelector('.slink-remove-entry').textContent =
			(typeof t === 'function') ? t('slink_uploader', 'Remove') : 'Remove';
		entriesBody.appendChild(tr);
	}

	function serializeEntries(entriesBody) {
		var entries = [];
		var rows = entriesBody.querySelectorAll('tr');
		for (var i = 0; i < rows.length; i++) {
			var name = rows[i].querySelector('.entry-name').value.trim();
			var params = rows[i].querySelector('.entry-params').value.trim().replace(/^[?&]+/, '');
			if (name !== '') {
				entries.push({ name: name, params: params });
			}
		}
		document.getElementById('slink-menu-entries').value = JSON.stringify(entries);
	}

	function init() {
		var form = document.getElementById('slink-uploader-form');
		if (!form) {
			return;
		}
		var status = document.getElementById('slink-uploader-status');
		var entriesBody = document.getElementById('slink-entries-body');

		var addEntryButton = document.getElementById('slink-add-entry');
		if (addEntryButton) {
			addEntryButton.addEventListener('click', function () {
				addEntryRow(entriesBody, '', '');
				var rows = entriesBody.querySelectorAll('.entry-name');
				if (rows.length) {
					rows[rows.length - 1].focus();
				}
			});
		}
		if (entriesBody) {
			entriesBody.addEventListener('click', function (e) {
				if (e.target.classList && e.target.classList.contains('slink-remove-entry')) {
					var tr = e.target.closest('tr');
					if (tr) {
						tr.parentNode.removeChild(tr);
					}
				}
			});
		}

		form.addEventListener('submit', function (e) {
			e.preventDefault();
			// Native field validation (required/pattern attributes); the
			// server re-validates everything anyway.
			if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
				return;
			}
			status.textContent = '';
			serializeEntries(entriesBody);
			var data = new FormData(form);
			var headers = {
				'X-Requested-With': 'XMLHttpRequest',
				'Accept': 'application/json'
			};
			if (typeof OC !== 'undefined' && OC.requestToken) {
				headers['requesttoken'] = OC.requestToken;
			}
			fetch(OC.generateUrl('/apps/slink_uploader/config'), {
				method: 'POST',
				headers: headers,
				body: data,
				credentials: 'same-origin'
			}).then(function (res) {
				return res.json().then(function (body) { return { ok: res.ok, body: body }; });
			}).then(function (result) {
				if (result.ok && result.body && result.body.status === 'saved') {
					status.textContent = '✓ ' + (typeof t === 'function'
						? t('slink_uploader', 'Saved')
						: 'Saved');
				} else {
					status.textContent = '⚠ ' + ((result.body && (result.body.message || result.body.error))
						|| (typeof t === 'function' ? t('slink_uploader', 'Error') : 'Error'));
				}
			}).catch(function () {
				status.textContent = '⚠ ' + (typeof t === 'function' ? t('slink_uploader', 'Request failed') : 'Request failed');
			});
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
