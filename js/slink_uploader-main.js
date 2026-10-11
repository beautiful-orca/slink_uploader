/**
 * Slink Uploader – file actions for the Nextcloud Files app.
 *
 * Build-free registration of the context-menu actions, compatible with
 * both Files app generations:
 *
 * - Nextcloud 30–32 ship @nextcloud/files v3: actions are registered
 *   through the global store `OCA.Files.fileActions` (positional
 *   callbacks: displayName(files, view), exec(file, view, dir)).
 * - Nextcloud 33+ ship @nextcloud/files v4: `OCA.Files.fileActions` is
 *   gone; actions are registered through the global scope
 *   `window._nc_files_scope.v4_0` (context objects with context.nodes),
 *   the same way the library's registerFileAction() does it.
 *
 * The context-menu entries (display name + URL parameters appended to
 * the share URL) are configured by the admin in the app settings and
 * fetched from the server; one file action is registered per entry.
 * Without any configured entries, a single default "Upload to Slink"
 * action is shown.
 */
(function () {
	'use strict';

	var ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">'
		+ '<path fill="currentColor" d="M8 2.5a4.5 4.5 0 0 1 4.36 3.39A3.5 3.5 0 0 1 12.5 13H4a3 3 0 0 1-.42-5.96A4.5 4.5 0 0 1 8 2.5zm.7 2.3L6.3 7.2a.7.7 0 0 0 .5 1.2h.8v2.1c0 .39.31.7.7.7s.7-.31.7-.7V8.4h.8a.7.7 0 0 0 .5-1.2L8.7 4.8z"/>'
		+ '</svg>';

	function translate(text) {
		return (typeof t === 'function') ? t('slink_uploader', text) : text;
	}

	function isImageNode(node) {
		return !!(node && node.mime && node.mime.indexOf('image/') === 0 && (node.fileid || node.id));
	}

	function getFileId(node) {
		return node.fileid || node.id;
	}

	function showToast(message, isError, durationMs) {
		var toast = document.createElement('div');
		toast.textContent = message;
		toast.setAttribute('role', 'status');
		applyToastStyle(toast, isError);
		document.body.appendChild(toast);
		window.setTimeout(function () {
			if (toast.parentNode) {
				toast.parentNode.removeChild(toast);
			}
		}, durationMs || 6000);
	}

	function applyToastStyle(toast, isError) {
		toast.style.cssText =
			'position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);'
			+ 'z-index: 9999; max-width: 90vw; overflow-wrap: anywhere;'
			+ 'padding: 10px 16px; border-radius: 8px; font-size: 13px;'
			+ 'background: var(--color-primary-element, #00639a);'
			+ 'color: var(--color-primary-element-text, #ffffff);'
			+ 'box-shadow: 0 4px 12px rgba(0,0,0,.25);';
		if (isError) {
			toast.style.background = 'var(--color-error, #e9322d)';
		}
	}

	// Copy to clipboard. navigator.clipboard requires a secure context and
	// may reject the write after the async upload (user activation expired),
	// so fall back to the deprecated execCommand approach.
	function copyToClipboard(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text)
				.then(function () { return true; })
				.catch(function () { return legacyCopy(text); });
		}
		return Promise.resolve(legacyCopy(text));
	}

	function legacyCopy(text) {
		try {
			var area = document.createElement('textarea');
			area.value = text;
			area.setAttribute('readonly', '');
			area.style.cssText = 'position: fixed; left: -9999px; top: 0; opacity: 0;';
			document.body.appendChild(area);
			area.focus();
			area.select();
			var ok = document.execCommand('copy');
			document.body.removeChild(area);
			return !!ok;
		} catch (e) {
			return false;
		}
	}

	function handleFiles(nodes, params, name) {
		var images = (nodes || []).filter(isImageNode);
		if (images.length === 0) {
			return Promise.resolve(null);
		}
		var file = images[0];

		var headers = {
			'Content-Type': 'application/json',
			'X-Requested-With': 'XMLHttpRequest',
			'Accept': 'application/json'
		};
		if (typeof OC !== 'undefined' && OC.requestToken) {
			headers['requesttoken'] = OC.requestToken;
		}

		var url = (typeof OC !== 'undefined' && OC.generateUrl)
			? OC.generateUrl('/apps/slink_uploader/upload')
			: '/index.php/apps/slink_uploader/upload';

		return fetch(url, {
			method: 'POST',
			headers: headers,
			body: JSON.stringify({ fileId: getFileId(file), params: params || '', name: name || '' }),
			credentials: 'same-origin'
		}).then(function (response) {
			return response.json().then(function (body) {
				return { ok: response.ok, body: body };
			});
		}).then(function (result) {
			if (!result.ok || !result.body || !result.body.url) {
				var msg = (result.body && (result.body.message || result.body.error)) || 'Unknown error';
				showToast(translate('Slink upload failed') + ': ' + msg, true, 9000);
				return null;
			}
			var shareUrl = result.body.url;

			return copyToClipboard(shareUrl).then(function (copied) {
				var lead;
				if (result.body.duplicate) {
					lead = translate('Slink URL of the already uploaded image (reused)');
				} else {
					lead = copied
						? translate('Slink URL copied to clipboard')
						: translate('Slink URL (also saved as file comment)');
				}
				var text = lead + ': ' + shareUrl;
				if (result.body.comment === 'skipped') {
					text += ' — ' + translate('Could not save the file comment');
				}
				showToast(text, false, copied ? 7000 : 15000);
				return null;
			});
		}).catch(function () {
			showToast(translate('Slink upload failed') + ': ' + translate('Request failed'), true, 9000);
			return null;
		});
	}

	// Fetch the configured context-menu entries from the server.
	// Resolves to the entries array, [] for "none configured", or null on
	// failure (then the default action is registered instead).
	function fetchEntries() {
		var url = (typeof OC !== 'undefined' && OC.generateUrl)
			? OC.generateUrl('/apps/slink_uploader/entries')
			: '/index.php/apps/slink_uploader/entries';
		var headers = {
			'Accept': 'application/json',
			'X-Requested-With': 'XMLHttpRequest'
		};
		if (typeof OC !== 'undefined' && OC.requestToken) {
			headers['requesttoken'] = OC.requestToken;
		}
		return fetch(url, {
			method: 'GET',
			headers: headers,
			credentials: 'same-origin'
		}).then(function (response) {
			if (!response.ok) {
				return null;
			}
			return response.json();
		}).then(function (body) {
			return (body && Array.isArray(body.entries)) ? body.entries : null;
		}).catch(function () {
			return null;
		});
	}

	/**
	 * Which Files app registration channel is available?
	 * - 'v3': NC 30–32, global store OCA.Files.fileActions
	 * - 'v4': NC 33+, global scope window._nc_files_scope.v4_0
	 * - null: neither loaded yet (or not a Files page)
	 */
	function findChannel() {
		var major = 0;
		if (typeof OC !== 'undefined' && OC.config && OC.config.version) {
			var parsed = parseInt(String(OC.config.version).split('.')[0], 10);
			if (!isNaN(parsed)) {
				major = parsed;
			}
		}
		var store = (typeof OCA !== 'undefined' && OCA.Files && OCA.Files.fileActions
			&& typeof OCA.Files.fileActions.registerFileAction === 'function')
			? OCA.Files.fileActions : null;
		var scope = (typeof window !== 'undefined' && window._nc_files_scope
			&& window._nc_files_scope.v4_0) || null;
		if (major >= 33) {
			return scope ? 'v4' : null;
		}
		if (major > 0) {
			return store ? 'v3' : null;
		}
		// Unknown version: take whichever channel is available.
		return store ? 'v3' : (scope ? 'v4' : null);
	}

	// v3 action shape (@nextcloud/files v3, NC 30–32):
	// displayName and iconSvgInline must be functions; exec receives a
	// single Node positionally.
	function buildV3Action(entry, index) {
		var name = entry.name || 'Upload to Slink';
		var params = entry.params || '';
		return {
			id: 'slink-upload-' + index,
			displayName: function () {
				return translate(name);
			},
			iconSvgInline: function () {
				return ICON_SVG;
			},
			enabled: function (files) {
				return !!(files && files.some && files.some(isImageNode));
			},
			exec: function (file) {
				return handleFiles([file], params, name);
			}
		};
	}

	// v4 action shape (@nextcloud/files v4, NC 33+):
	// all callbacks receive a context object with context.nodes.
	function buildV4Action(entry, index) {
		var name = entry.name || 'Upload to Slink';
		var params = entry.params || '';
		return {
			id: 'slink-upload-' + index,
			displayName: function () {
				return translate(name);
			},
			iconSvgInline: function () {
				return ICON_SVG;
			},
			enabled: function (context) {
				return !!(context && context.nodes && context.nodes.some
					&& context.nodes.some(isImageNode));
			},
			exec: function (context) {
				return handleFiles((context && context.nodes) ? context.nodes : [], params, name);
			}
		};
	}

	// Mirrors @nextcloud/files v4 registerFileAction(): store the action
	// in the global Map (the Files app reads it during its init) and
	// dispatch a registry event (covers late registration after init).
	function registerV4(action) {
		var scope = window._nc_files_scope = window._nc_files_scope || {};
		var s = scope.v4_0 = scope.v4_0 || {};
		if (!s.fileActions || typeof s.fileActions.has !== 'function') {
			s.fileActions = new Map();
		}
		if (s.fileActions.has(action.id)) {
			return;
		}
		s.fileActions.set(action.id, action);
		if (!s.registry || typeof s.registry.dispatchEvent !== 'function') {
			s.registry = new EventTarget();
		}
		s.registry.dispatchEvent(new CustomEvent('register:action', { detail: action }));
	}

	function registerActions(entries, channel) {
		var list = (entries && entries.length > 0)
			? entries
			: [{ name: 'Upload to Slink', params: '' }];
		for (var i = 0; i < list.length; i++) {
			var action = (channel === 'v4')
				? buildV4Action(list[i], i)
				: buildV3Action(list[i], i);
			if (channel === 'v4') {
				registerV4(action);
			} else {
				OCA.Files.fileActions.registerFileAction(action);
			}
		}
		return true;
	}

	var registered = false;
	var fetchStarted = false;
	var fetchResolved = false;
	var fetchedEntries = [];

	function tryRegister() {
		if (registered) {
			return true;
		}
		var channel = findChannel();
		if (!channel) {
			return false;
		}
		if (!fetchStarted) {
			fetchStarted = true;
			fetchEntries().then(function (entries) {
				// null (failed fetch) falls back to the default action.
				fetchedEntries = (entries !== null) ? entries : [];
				fetchResolved = true;
			});
			return false;
		}
		if (!fetchResolved) {
			return false;
		}
		registered = registerActions(fetchedEntries, channel);
		return registered;
	}

	var attempts = 0;
	var timer = window.setInterval(function () {
		attempts++;
		// Give up after ~30s without a registration channel (e.g. this
		// page is not the Files app).
		if (tryRegister() || attempts > 150) {
			window.clearInterval(timer);
		}
	}, 200);
})();
