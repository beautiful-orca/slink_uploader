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

	// Toast styled like Nextcloud's own toasts: colored through the
	// server's design tokens (CSS variables), so it follows the theme
	// (including dark mode) with readable dark-on-light text.
	var TOAST_STYLE = '.slink-toast{'
		+ 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);'
		+ 'z-index:10000;display:flex;align-items:center;max-width:90vw;'
		+ 'padding:10px 12px;border-radius:var(--border-radius,8px);'
		+ 'background:var(--color-main-background,#ffffff);'
		+ 'color:var(--color-main-text,#222222);'
		+ 'font-size:var(--default-font-size,13px);line-height:1.5;'
		+ 'box-shadow:0 4px 12px var(--color-box-shadow,rgba(0,0,0,.25));'
		+ 'animation:slink-toast-in .25s ease-out;}'
		+ '.slink-toast--error{border-left:3px solid var(--color-error,#e9322d);}'
		+ '.slink-toast__text{overflow-wrap:anywhere;}'
		+ '.slink-toast .slink-toast__copy{flex:0 0 auto;margin:0 0 0 12px;'
		+ 'padding:6px 14px;border:none;border-radius:var(--border-radius,8px);'
		+ 'background:var(--color-primary-element,#00639a);'
		+ 'color:var(--color-primary-element-text,#ffffff);'
		+ 'font-size:var(--default-font-size,13px);white-space:nowrap;cursor:pointer;}'
		+ '.slink-toast .slink-toast__copy:hover,'
		+ '.slink-toast .slink-toast__copy:focus-visible{'
		+ 'background:var(--color-primary-element-hover,#0074b2);}'
		+ '.slink-toast .slink-toast__copy[disabled]{cursor:default;opacity:.65;'
		+ 'background:var(--color-success,#46ba61);}'
		+ '@keyframes slink-toast-in{'
		+ 'from{opacity:0;transform:translate(-50%,8px);}'
		+ 'to{opacity:1;transform:translate(-50%,0);}}';

	function ensureToastStyle() {
		if (document.getElementById('slink-toast-style')) {
			return;
		}
		var style = document.createElement('style');
		style.id = 'slink-toast-style';
		style.textContent = TOAST_STYLE;
		document.head.appendChild(style);
	}

	function showToast(message, isError, durationMs) {
		ensureToastStyle();
		var toast = document.createElement('div');
		toast.className = 'slink-toast' + (isError ? ' slink-toast--error' : '');
		toast.setAttribute('role', 'status');
		var text = document.createElement('span');
		text.className = 'slink-toast__text';
		text.textContent = message;
		toast.appendChild(text);
		document.body.appendChild(toast);
		window.setTimeout(function () {
			if (toast.parentNode) {
				toast.parentNode.removeChild(toast);
			}
		}, durationMs || 6000);
		return toast;
	}

	// Copy to clipboard. navigator.clipboard requires a secure context and
	// may reject the write once the user activation of the click has
	// expired, so fall back to the deprecated execCommand approach.
	// Both only work from a user gesture — see reserveClipboard() for
	// how the gesture is kept alive across the async upload.
	function copyToClipboard(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text)
				.then(function () { return true; })
				.catch(function () { return legacyCopy(text); });
		}
		return Promise.resolve(legacyCopy(text));
	}

	function legacyCopy(text) {
		var area = document.createElement('textarea');
		area.value = text;
		area.setAttribute('readonly', '');
		area.style.cssText = 'position: fixed; left: -9999px; top: 0; opacity: 0;';
		document.body.appendChild(area);
		try {
			area.focus();
			area.select();
			return !!document.execCommand('copy');
		} catch (e) {
			return false;
		} finally {
			document.body.removeChild(area);
		}
	}

	/**
	 * Browsers only allow clipboard writes from a transient user
	 * activation (the click), which expires a few seconds after the
	 * click, and only while the document is focused. The share URL is
	 * only known after the upload, so a plain writeText() at that
	 * point is rejected whenever the upload took too long — the copy
	 * worked only for fast uploads, which is why it seemed random.
	 *
	 * Fix: reserve the clipboard synchronously at click time, while
	 * the activation is fresh. clipboard.write() checks the user
	 * activation when it is called, and its payload promise may
	 * resolve much later — this keeps the click's gesture alive
	 * across the upload. Supported by Chromium and Safari; optional
	 * (callers fall back to a direct copy attempt).
	 */
	function reserveClipboard() {
		var unsupported = { supported: false, resolve: function () {}, reject: function () {} };
		if (typeof ClipboardItem === 'undefined'
			|| !navigator.clipboard || typeof navigator.clipboard.write !== 'function') {
			return unsupported;
		}
		var fulfill;
		var cancel;
		var payload = new Promise(function (resolve, reject) {
			fulfill = resolve;
			cancel = reject;
		});
		try {
			var write = navigator.clipboard.write([
				new ClipboardItem({ 'text/plain': payload })
			]);
			return {
				supported: true,
				// Deliver the URL to the reserved write (a Blob is the
				// payload form both Chromium and Safari accept).
				resolve: function (text) {
					fulfill(new Blob([text], { type: 'text/plain' }));
				},
				// Upload failed: cancel the reserved write — nothing
				// is copied.
				reject: function () {
					cancel(new Error('cancelled'));
				},
				// Resolves to true once the reserved write has been
				// committed, false if it failed (caller falls back).
				settled: write.then(function () { return true; }, function () { return false; })
			};
		} catch (e) {
			return unsupported;
		}
	}

	/**
	 * Copy the share URL once the upload has finished: through the
	 * clipboard reservation made at click time, falling back to a
	 * direct copy attempt (which may be rejected because the user
	 * activation has expired by then). Resolves to true when the URL
	 * is on the clipboard.
	 */
	function copyAfterUpload(text, reservation) {
		if (!reservation.supported) {
			return copyToClipboard(text);
		}
		reservation.resolve(text);
		return reservation.settled.then(function (copied) {
			return copied ? true : copyToClipboard(text);
		});
	}

	// The success toast always carries a Copy button. Usually the
	// automatic copy has already succeeded and the button just
	// allows re-copying the URL; when every automatic attempt was
	// rejected, its click carries a fresh user activation, so the
	// copy works in every browser.
	function appendCopyButton(toast, text) {
		var button = document.createElement('button');
		button.type = 'button';
		button.className = 'slink-toast__copy';
		button.textContent = translate('Copy');
		button.addEventListener('click', function (event) {
			event.preventDefault();
			event.stopPropagation();
			copyToClipboard(text).then(function (copied) {
				if (copied) {
					button.textContent = translate('Copied');
					button.disabled = true;
				}
			});
		});
		toast.appendChild(button);
	}

	function handleFiles(nodes, params, name) {
		var images = (nodes || []).filter(isImageNode);
		if (images.length === 0) {
			return Promise.resolve(null);
		}
		var file = images[0];

		// Reserve the clipboard synchronously, while the click's user
		// activation is still fresh (see reserveClipboard).
		var reservation = reserveClipboard();

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
				reservation.reject();
				var msg = (result.body && (result.body.message || result.body.error)) || 'Unknown error';
				showToast(translate('Slink upload failed') + ': ' + msg, true, 9000);
				return null;
			}
			var shareUrl = result.body.url;

			return copyAfterUpload(shareUrl, reservation).then(function (copied) {
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
				var toast = showToast(text, false, copied ? 10000 : 15000);
				appendCopyButton(toast, shareUrl);
				return null;
			});
		}).catch(function () {
			reservation.reject();
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
