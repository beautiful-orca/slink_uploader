/**
 * Slink Uploader – Deck integration (card sidebar attachments).
 *
 * Deck offers no frontend API for attachment actions, so this script
 * injects the configured "Upload to Slink" context-menu entries into
 * the three-dot menu of the attachment rows in the card sidebar by
 * watching the DOM with a MutationObserver (the sidebar is rendered
 * by Vue and re-renders on every card switch).
 *
 * How it works:
 *
 * 1. The script waits for window.OCA.Deck (the Deck bundle sets it after
 *    mounting); on non-Deck pages it gives up after ~30s and stays idle.
 * 2. The configured context-menu entries are fetched from the server
 *    (GET /apps/slink_uploader/entries); without any configured
 *    entries a single default "Upload to Slink" action is shown.
 * 3. A MutationObserver on <body> watches for attachment rows in the
 *    card sidebar (or the card modal – both render the same list).
 *    The current card is read from the URL (Deck's vue-router renders
 *    /apps/deck/board/<id>/card/<cardId>; older hash-based routes are
 *    covered as well) and the card's attachments are loaded read-only
 *    through Deck's own endpoints: Deck 1.18+ exposes an OCS route,
 *    older versions only the plain app route (tried as fallback; the
 *    markup and routes were verified against Deck 1.17.6 and 1.18.5).
 *    The DOM rows carry no file or attachment ID, so each row is
 *    mapped to an attachment by its displayed file name. Rows that
 *    cannot be mapped unambiguously get no entries — no guessing.
 * 4. Only attachments with a resolved file ID and an image/* MIME type
 *    are considered. Their three-dot menu (NcActions) receives one
 *    native-looking menu entry per configured context-menu entry; the
 *    entries are injected when the menu opens (NcActions renders its
 *    content lazily, teleported to <body> by the popover library).
 *    Rows without a three-dot menu (read-only boards) fall back to a
 *    single icon button with the default entry.
 * 5. A click uploads exactly that file through the existing endpoint
 *    POST /apps/slink_uploader/upload with {fileId, params, name} of
 *    the chosen entry; the Slink URL is copied to the clipboard and
 *    confirmed with a toast.
 *
 * Debugging: append ?slinkDebug=1 (or #slinkDebug=1) to the URL to get
 * console.debug output for every step (activation, card ID, OCS fetch,
 * row resolution, menu injection). See README "Deck app: attachments".
 *
 * Deliberately fragile: the selectors below are derived from Deck's
 * source (src/components/card/AttachmentList.vue / CardSidebar.vue) and
 * @nextcloud/vue (NcActions/NcActionButton). If a Deck or
 * @nextcloud/vue update changes the markup, the injection silently
 * stops working – check the selectors after Deck updates (see README).
 */
(function () {
	'use strict';

	/**
	 * Selectors kept central here, with fallbacks for older versions.
	 * Derived from Deck's source (checked against Deck main / 2.x and
	 * the 1.x line, 2026-10):
	 *
	 * - ul.attachment-list: the attachment list of the card sidebar /
	 *   card modal (src/components/card/AttachmentList.vue)
	 * - li.attachment: one attachment row; rows of the upload queue
	 *   contain a <progress> element, deleted rows have the class
	 *   "attachment--deleted" (both are skipped)
	 * - .filename: the displayed file name of a row (contains the
	 *   basename and the ".extension" spans)
	 * - button[aria-haspopup]: the three-dot trigger of an NcActions
	 *   menu in the row (used to detect rows that have no menu at all)
	 * - open menus are ul[role="menu"] elements rendered by the popover
	 *   library (floating-vue) teleported to <body>; their
	 *   aria-labelledby points to the trigger element inside the row,
	 *   which links a menu back to its attachment row (a trigger-side
	 *   aria-controls reference is used as an additional fallback)
	 * - the menu entries are li.action > button.action-button /
	 *   a.action-link (NcActionButton / NcActionLink markup)
	 *
	 * The card route is /board/<boardId>/card/<cardId> (vue-router web
	 * history; older Deck versions used the same path inside the hash).
	 */
	var ROW_SELECTORS = [
		'ul.attachment-list > li.attachment',
		'ul.attachment-list li.attachment'
	];
	var SELECTORS = {
		rowUploadQueue: 'progress',
		rowDeletedClass: 'attachment--deleted',
		rowFilename: '.filename',
		menuTrigger: 'button[aria-haspopup]',
		menuTriggerOpen: 'button[aria-expanded="true"][aria-controls]'
	};
	var CARD_URL_PATTERN = /\/card\/(\d+)/;

	// Marker attributes: prevent double work on the same row / menu
	// (Vue re-renders rows in place and re-creates menus on each open).
	var MARKER = 'data-slink-deck-injected';
	var MENU_MARKER = 'data-slink-deck-menu-injected';
	// Resolved file ID of a row (set once the row is mapped uniquely).
	var FILE_ID_ATTR = 'data-slink-deck-fileid';

	var BUTTON_CLASS = 'slink-deck-upload';
	var MENU_ENTRY_CLASS = 'slink-deck-menu-entry';
	// Core icon class (like icon-folder / icon-download of the native
	// entries); icon-upload is the same icon Deck's "Upload new files"
	// button uses.
	var MENU_ICON_CLASS = 'icon-upload';

	var DEFAULT_ENTRY = { name: 'Upload to Slink', params: '' };

	var ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">'
		+ '<path fill="currentColor" d="M8 2.5a4.5 4.5 0 0 1 4.36 3.39A3.5 3.5 0 0 1 12.5 13H4a3 3 0 0 1-.42-5.96A4.5 4.5 0 0 1 8 2.5zm.7 2.3L6.3 7.2a.7.7 0 0 0 .5 1.2h.8v2.1c0 .39.31.7.7.7s.7-.31.7-.7V8.4h.8a.7.7 0 0 0 .5-1.2L8.7 4.8z"/>'
		+ '</svg>';

	var BUTTON_STYLE = '.slink-deck-upload{'
		+ 'display:inline-flex;align-items:center;justify-content:center;'
		+ 'flex:0 0 auto;width:44px;height:44px;margin:0;padding:0;'
		+ 'border:none;border-radius:22px;background:transparent;'
		+ 'color:var(--color-main-text,#555);cursor:pointer;}'
		+ '.slink-deck-upload:hover,.slink-deck-upload:focus-visible{'
		+ 'background:var(--color-background-hover,rgba(127,127,127,.25));}'
		+ '.slink-deck-upload svg{width:16px;height:16px;}'
		+ '.slink-deck-upload[disabled]{opacity:.5;cursor:default;}'
		// Hide the fallback button on rows that became deleted afterwards.
		+ 'li.attachment--deleted .slink-deck-upload{display:none;}';

	// Debug mode: append ?slinkDebug=1 (or #slinkDebug=1) to the page URL.
	var DEBUG = /slinkDebug=1/.test(window.location.search + window.location.hash);

	function debugLog() {
		if (!DEBUG) {
			return;
		}
		var args = Array.prototype.slice.call(arguments);
		args.unshift('[Slink Deck]');
		// console.log (not console.debug) so the lines are visible in
		// Chrome without enabling the "Verbose" filter.
		if (typeof console !== 'undefined' && console.log) {
			console.log.apply(console, args);
		}
	}

	function translate(text) {
		return (typeof t === 'function') ? t('slink_uploader', text) : text;
	}

	// Toast styled like Nextcloud's own toasts: colored through the
	// server's design tokens (CSS variables), so it follows the theme
	// (including dark mode) with readable dark-on-light text.
	// (Same markup and styling as js/slink_uploader-main.js.)
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
	// (Same rationale as js/slink_uploader-main.js.)
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

	function generateUrl(path) {
		// OC.generateUrl prepends the webroot (and index.php if rewrite
		// is unavailable). No {placeholder} replacement is used on
		// purpose — support differs between NC versions.
		if (typeof OC !== 'undefined' && OC.generateUrl) {
			return OC.generateUrl(path);
		}
		return '/index.php' + path;
	}

	/**
	 * The card ID of the currently opened card, from the URL. Deck's
	 * router renders /apps/deck/board/<boardId>/card/<cardId> (web
	 * history); older versions put the same path into the hash. Returns
	 * null when no card is open.
	 */
	function currentCardId() {
		var match = (window.location.pathname + '#' + window.location.hash).match(CARD_URL_PATTERN);
		return match ? parseInt(match[1], 10) : null;
	}

	/**
	 * Load the attachments of a card read-only, exactly like the Deck
	 * frontend itself does (src/services/AttachmentApi.js). Deck
	 * versions differ:
	 * - Deck 1.18+ exposes OCS GET
	 *   /apps/deck/api/v1.0/cards/<cardId>/attachments (OCS envelope)
	 *   and uses it itself.
	 * - Deck 1.17 and older only expose the plain app route
	 *   GET /apps/deck/cards/<cardId>/attachments (plain JSON array,
	 *   same data), which also still exists in 1.18+.
	 * The OCS endpoint is tried first; on failure the plain route is
	 * used and the working variant is remembered for the session.
	 * Resolves to the attachment array or null on failure.
	 */
	var ocsAttachmentsFailed = false;

	function fetchAttachments(cardId) {
		var useOcs = !ocsAttachmentsFailed;
		return requestAttachments(attachmentsUrl(cardId, useOcs), useOcs).then(function (data) {
			if (data !== null) {
				return data;
			}
			if (useOcs) {
				ocsAttachmentsFailed = true;
				debugLog('OCS attachment request failed, falling back to the plain app route');
				return requestAttachments(attachmentsUrl(cardId, false), false);
			}
			return null;
		});
	}

	function attachmentsUrl(cardId, ocs) {
		if (ocs) {
			return generateUrl('/ocs/v2.php/apps/deck/api/v1.0/cards')
				+ '/' + encodeURIComponent(String(cardId)) + '/attachments';
		}
		return generateUrl('/apps/deck/cards')
			+ '/' + encodeURIComponent(String(cardId)) + '/attachments';
	}

	function requestAttachments(url, ocs) {
		var headers = {
			'Accept': 'application/json',
			'X-Requested-With': 'XMLHttpRequest'
		};
		if (ocs) {
			headers['OCS-APIRequest'] = 'true';
		}
		if (typeof OC !== 'undefined' && OC.requestToken) {
			headers['requesttoken'] = OC.requestToken;
		}
		debugLog('fetching attachments from', url);
		return fetch(url, {
			method: 'GET',
			headers: headers,
			credentials: 'same-origin'
		}).then(function (response) {
			if (!response.ok) {
				debugLog('attachment request failed with HTTP', response.status);
				return null;
			}
			return response.json();
		}).then(function (body) {
			var data = null;
			if (Array.isArray(body)) {
				// Plain app route: the response is the array itself.
				data = body;
			} else if (body && body.ocs && Array.isArray(body.ocs.data)) {
				// OCS envelope.
				data = body.ocs.data;
			}
			if (!data) {
				debugLog('attachment response has no usable data', body);
				return null;
			}
			debugLog('received', data.length, 'attachments');
			return data;
		}).catch(function (e) {
			debugLog('attachment request threw', e);
			return null;
		});
	}

	/**
	 * Fetch the configured context-menu entries from the server (same
	 * request as js/slink_uploader-main.js). Until it resolves, and as a
	 * fallback if it fails, the default entry is used.
	 */
	var menuEntries = null;

	function fetchEntries() {
		var headers = {
			'Accept': 'application/json',
			'X-Requested-With': 'XMLHttpRequest'
		};
		if (typeof OC !== 'undefined' && OC.requestToken) {
			headers['requesttoken'] = OC.requestToken;
		}
		return fetch(generateUrl('/apps/slink_uploader/entries'), {
			method: 'GET',
			headers: headers,
			credentials: 'same-origin'
		}).then(function (response) {
			if (!response.ok) {
				debugLog('entries request failed with HTTP', response.status);
				return null;
			}
			return response.json();
		}).then(function (body) {
			return (body && Array.isArray(body.entries)) ? body.entries : null;
		}).catch(function (e) {
			debugLog('entries request threw', e);
			return null;
		});
	}

	function getEntries() {
		return (menuEntries && menuEntries.length > 0) ? menuEntries : [DEFAULT_ENTRY];
	}

	/**
	 * The name a row displays for an attachment. Mirrors the logic of
	 * Deck's AttachmentList.vue (attachmentBasename/attachmentExtension):
	 * extendedData.info.filename/.extension when present, otherwise the
	 * attachment's data field is a file name like "cardId-<name>".
	 */
	function attachmentDisplayName(attachment) {
		var extended = attachment.extendedData || {};
		var info = extended.info || {};
		var source = (typeof attachment.name === 'string' && attachment.name !== '')
			? attachment.name
			: (typeof attachment.data === 'string' ? attachment.data : '');
		var basename = (typeof info.filename === 'string' && info.filename !== '')
			? info.filename
			: source.replace(/\.[^/.]+$/, '');
		var extension = (typeof info.extension === 'string' && info.extension !== '')
			? info.extension
			: (source.indexOf('.') !== -1 ? source.split('.').pop() : '');
		return extension !== '' ? basename + '.' + extension : basename;
	}

	/**
	 * Whether an attachment is an image file that can be uploaded:
	 * it must have a resolvable file ID and an image/* MIME type
	 * (both come from Deck's server-side extendData()).
	 */
	function imageFileId(attachment) {
		var extended = attachment.extendedData || {};
		var fileId = extended.fileid || null;
		var mimetype = (typeof extended.mimetype === 'string') ? extended.mimetype : '';
		return (fileId && mimetype.indexOf('image/') === 0) ? fileId : null;
	}

	/**
	 * Build the name -> attachments index of a card. A row is only
	 * mapped when exactly one attachment in the whole list carries its
	 * displayed name (no rate guessing for ambiguous names).
	 */
	function buildNameIndex(attachments) {
		var index = {};
		for (var i = 0; i < attachments.length; i++) {
			var name = normalizeName(attachmentDisplayName(attachments[i]));
			if (!index[name]) {
				index[name] = [];
			}
			index[name].push(attachments[i]);
		}
		if (DEBUG) {
			var names = [];
			for (var key in index) {
				names.push(key + ' (' + index[key].length + ')');
			}
			debugLog('name index:', names.join(', '));
		}
		return index;
	}

	function rowDisplayName(row) {
		var name = row.querySelector(SELECTORS.rowFilename);
		return normalizeName(name ? (name.textContent || '') : '');
	}

	function normalizeName(text) {
		// The row's .filename textContent contains the template
		// whitespace between the basename and extension spans (Vue
		// renders "Birdie" + whitespace + ".jpg"), so ALL whitespace is
		// stripped on both sides before comparing. Names that differ
		// only in whitespace collide and are treated as ambiguous.
		return (text || '').replace(/\s+/g, '');
	}

	// ------------------------------------------------------------------
	// Row lookup (selector with fallbacks for older Deck versions)
	// ------------------------------------------------------------------

	function queryRows() {
		var rows = [];
		for (var s = 0; s < ROW_SELECTORS.length; s++) {
			var found = document.querySelectorAll(ROW_SELECTORS[s]);
			for (var i = 0; i < found.length; i++) {
				if (rows.indexOf(found[i]) === -1) {
					rows.push(found[i]);
				}
			}
			// The first selector that matches anything wins; the
			// fallbacks are only for older Deck markups.
			if (rows.length > 0) {
				break;
			}
		}
		return rows;
	}

	// ------------------------------------------------------------------
	// Menu injection (native three-dot menu of an attachment row)
	// ------------------------------------------------------------------

	/**
	 * The attachment row an open menu belongs to, or null. Open menus
	 * are rendered teleported to <body> by the popover library, so the
	 * link runs over element ids, not DOM position:
	 * 1. the menu's aria-labelledby points to the trigger element
	 *    inside the row (NcActions sets it on the open menu),
	 * 2. a trigger inside a row with aria-controls referencing the menu,
	 * 3. legacy: the menu itself rendered inline inside the row.
	 */
	function menuRow(menu) {
		var labelledBy = menu.getAttribute('aria-labelledby');
		if (labelledBy) {
			var trigger = document.getElementById(labelledBy);
			if (trigger) {
				var row = trigger.closest('li.attachment');
				if (row) {
					return row;
				}
			}
		}
		var inlineRow = menu.closest('li.attachment');
		if (inlineRow) {
			return inlineRow;
		}
		var rows = queryRows();
		for (var i = 0; i < rows.length; i++) {
			var openTrigger = rows[i].querySelector(SELECTORS.menuTriggerOpen);
			if (openTrigger && openTrigger.getAttribute('aria-controls') === menu.id) {
				return rows[i];
			}
		}
		return null;
	}

	/**
	 * Inject one menu entry per configured context-menu entry into an
	 * open menu. Each entry is a clone of a native menu entry of the
	 * same menu — cloned elements carry the data-v-* attributes of
	 * @nextcloud/vue's scoped styles, so the entries get exactly the
	 * same styling as the native ones ("Show in Files", "Download",
	 * ...). Hand-built markup would lack those attributes and fall
	 * back to unstyled browser defaults. If the menu has no native
	 * button entry to clone from, a minimal hand-built fallback is
	 * used.
	 */
	function injectMenuEntries(menu, fileId) {
		var entries = getEntries();
		var template = findNativeEntryTemplate(menu);
		menu.setAttribute(MENU_MARKER, '1');
		for (var i = 0; i < entries.length; i++) {
			menu.appendChild(buildMenuEntry(entries[i], fileId, template));
		}
		debugLog('injected', entries.length, 'entries into menu', menu.id || '(no id)',
			template ? '(cloned from a native entry)' : '(hand-built fallback)');
	}

	/**
	 * A native li.action with a button (NcActionButton, e.g. "Remove
	 * attachment") to clone our entries from. Links (NcActionLink)
	 * are not suitable — their interactive element is an <a>.
	 */
	function findNativeEntryTemplate(menu) {
		var buttons = menu.querySelectorAll('li.action:not(.' + MENU_ENTRY_CLASS + ') button.action-button');
		for (var i = 0; i < buttons.length; i++) {
			var li = buttons[i].closest('li.action');
			if (li) {
				return li;
			}
		}
		return null;
	}

	function buildMenuEntry(entry, fileId, template) {
		var li;
		var button;
		var icon;
		var text;

		if (template) {
			// cloneNode(true) copies the markup including the scoped
			// style attributes (data-v-*) but NOT the event listeners.
			li = template.cloneNode(true);
			li.removeAttribute('id');
			li.classList.remove('active');
			button = li.querySelector('button.action-button');
			icon = li.querySelector('.action-button__icon');
			text = li.querySelector('.action-button__text');
			button.classList.remove('action-button--active');
			button.removeAttribute('title');
			button.removeAttribute('disabled');
			button.removeAttribute('aria-checked');
		} else {
			li = document.createElement('li');
			li.className = 'action ' + MENU_ENTRY_CLASS;
			li.setAttribute('role', 'presentation');
			button = document.createElement('button');
			button.type = 'button';
			// "focusable" is the class NcActions uses for its keyboard
			// navigation between menu entries.
			button.className = 'action-button button-vue focusable';
			button.setAttribute('role', 'menuitem');
			icon = document.createElement('span');
			icon.setAttribute('aria-hidden', 'true');
			button.appendChild(icon);
			var wrapper = document.createElement('span');
			wrapper.className = 'action-button__longtext-wrapper';
			text = document.createElement('span');
			text.className = 'action-button__text';
			wrapper.appendChild(text);
			button.appendChild(wrapper);
			li.appendChild(button);
		}

		// Core icon class (like icon-folder / icon-download / icon-delete
		// of the native entries) on the same icon span: rendered by the
		// same CSS as the native icons.
		icon.className = 'action-button__icon ' + MENU_ICON_CLASS;
		text.textContent = entry.name || DEFAULT_ENTRY.name;

		button.addEventListener('click', function (event) {
			event.preventDefault();
			event.stopPropagation();
			closeMenu();
			uploadAttachment(button, entry, fileId);
		});
		return li;
	}

	/**
	 * Close the popover menu after a click, like native entries do
	 * (the popover closes on outside pointer events; a synthetic
	 * mousedown outside the menu is enough). If it does not work, the
	 * menu simply stays open – harmless.
	 */
	function closeMenu() {
		try {
			document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		} catch (e) {
			// Older browsers: menu stays open, no problem.
		}
	}

	/**
	 * Fallback for rows without a native three-dot menu (read-only
	 * boards): a single icon button with the default entry.
	 */
	function injectFallbackButton(row, fileId) {
		var button = document.createElement('button');
		button.type = 'button';
		button.className = BUTTON_CLASS;
		button.title = translate('Upload to Slink');
		button.setAttribute('aria-label', translate('Upload to Slink'));
		button.innerHTML = ICON_SVG;
		button.addEventListener('click', function (event) {
			event.preventDefault();
			event.stopPropagation();
			uploadAttachment(button, DEFAULT_ENTRY, fileId);
		});
		row.appendChild(button);
	}

	/**
	 * Upload exactly this attachment's file through the existing
	 * endpoint, with the chosen entry's URL parameters and name (the
	 * server looks up the entry's processing options by name).
	 */
	function uploadAttachment(button, entry, fileId) {
		if (button.disabled) {
			return;
		}
		button.disabled = true;

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

		return fetch(generateUrl('/apps/slink_uploader/upload'), {
			method: 'POST',
			headers: headers,
			body: JSON.stringify({ fileId: fileId, params: entry.params || '', name: entry.name || '' }),
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
		}).then(function () {
			button.disabled = false;
		});
	}

	// ------------------------------------------------------------------
	// Attachment cache: one fetch per card; refetched when a row shows a
	// name the cache does not know (new attachment uploaded meanwhile).
	// ------------------------------------------------------------------

	var attachmentCache = {};
	var cacheFetchAt = {};

	function ensureIndex(cardId) {
		// Cache the in-flight promise as well so parallel scans (Vue
		// re-renders a lot) do not fire duplicate OCS requests.
		if (attachmentCache[cardId]) {
			return attachmentCache[cardId];
		}
		attachmentCache[cardId] = fetchAttachments(cardId).then(function (attachments) {
			if (!attachments) {
				// Fetch failed: drop the promise so the next scan retries.
				delete attachmentCache[cardId];
				return null;
			}
			cacheFetchAt[cardId] = Date.now();
			return buildNameIndex(attachments);
		});
		return attachmentCache[cardId];
	}

	function invalidateCache(cardId) {
		delete attachmentCache[cardId];
	}

	// ------------------------------------------------------------------
	// Scan + MutationObserver
	// ------------------------------------------------------------------

	function pendingRows() {
		var rows = queryRows();
		var pending = [];
		for (var i = 0; i < rows.length; i++) {
			var row = rows[i];
			if (row.getAttribute(MARKER)) {
				continue;
			}
			// Skip rows of the upload queue and already deleted attachments.
			if (row.querySelector(SELECTORS.rowUploadQueue) || row.classList.contains(SELECTORS.rowDeletedClass)) {
				continue;
			}
			pending.push(row);
		}
		return pending;
	}

	function scan() {
		var cardId = currentCardId();
		var rows = pendingRows();
		if (DEBUG) {
			debugLog('scan: cardId', cardId, '- pending rows', rows.length);
		}
		if (cardId === null || rows.length === 0) {
			injectIntoOpenMenus();
			return;
		}
		ensureIndex(cardId).then(function (index) {
			if (!index) {
				// Fetch failed: the next mutation retries the rows, but
				// already resolved rows must not lose their menu entries.
				injectIntoOpenMenus();
				return;
			}
			// The user may have switched cards while fetching.
			if (currentCardId() !== cardId) {
				return;
			}
			var unknown = false;
			for (var i = 0; i < rows.length; i++) {
				var row = rows[i];
				if (!row.isConnected || row.getAttribute(MARKER)) {
					continue;
				}
				var name = rowDisplayName(row);
				if (name === '') {
					// Unexpected markup: do not retry this row forever.
					debugLog('row without a file name, skipping permanently');
					row.setAttribute(MARKER, '1');
					continue;
				}
				var candidates = index[name];
				if (!candidates || candidates.length !== 1) {
					if (candidates) {
						// Known name, but ambiguous or not an image: no entries.
						debugLog('row', name, '-> no unique attachment,', candidates.length, 'candidates');
						row.setAttribute(MARKER, '1');
					} else {
						// Unknown name: the cache may be stale; refetch below.
						debugLog('row', name, '-> unknown attachment name');
						unknown = true;
					}
					continue;
				}
				var fileId = imageFileId(candidates[0]);
				debugLog('row', name, '->', fileId ? 'fileId ' + fileId : 'no image or no file id');
				if (fileId) {
					row.setAttribute(FILE_ID_ATTR, String(fileId));
					// Rows without a native three-dot menu (read-only
					// boards) get a single fallback button instead.
					if (!row.querySelector(SELECTORS.menuTrigger)) {
						injectFallbackButton(row, fileId);
					}
				}
				row.setAttribute(MARKER, '1');
			}
			if (unknown && Date.now() - (cacheFetchAt[cardId] || 0) > 3000) {
				invalidateCache(cardId);
				scheduleScan();
			}
			injectIntoOpenMenus();
		});
	}

	/**
	 * Inject the entries into every three-dot menu of an image row that
	 * is currently open. Runs on every scan so menus that open later
	 * (NcActions renders its content lazily on open, teleported to
	 * <body>) are filled as soon as they appear in the DOM.
	 */
	function injectIntoOpenMenus() {
		var menus = document.querySelectorAll('ul[role="menu"]');
		for (var i = 0; i < menus.length; i++) {
			var menu = menus[i];
			if (menu.getAttribute(MENU_MARKER)) {
				continue;
			}
			var row = menuRow(menu);
			var fileIdAttr = row ? row.getAttribute(FILE_ID_ATTR) : null;
			if (!fileIdAttr) {
				if (DEBUG && row) {
					debugLog('open menu found but its row has no resolved file id (menu', menu.id || '(no id)', ')');
				}
				continue;
			}
			injectMenuEntries(menu, parseInt(fileIdAttr, 10));
		}
	}

	var scanScheduled = false;
	function scheduleScan() {
		if (scanScheduled) {
			return;
		}
		scanScheduled = true;
		window.setTimeout(function () {
			scanScheduled = false;
			scan();
		}, 50);
	}

	function injectButtonStyle() {
		var style = document.createElement('style');
		style.id = 'slink-deck-upload-style';
		if (document.getElementById(style.id)) {
			return;
		}
		style.textContent = BUTTON_STYLE;
		document.head.appendChild(style);
	}

	function start() {
		debugLog('integration starting (debug mode on)');
		injectButtonStyle();
		fetchEntries().then(function (entries) {
			// null (failed fetch) falls back to the default entry.
			menuEntries = (entries !== null) ? entries : [];
			debugLog('configured entries:', menuEntries.map(function (e) { return e.name; }).join(', ') || '(none, default action)');
		});
		if (!document.body) {
			debugLog('no document.body yet, aborting');
			return;
		}
		var observer = new MutationObserver(scheduleScan);
		observer.observe(document.body, { childList: true, subtree: true });
		// Card switches via vue-router's pushState do not fire popstate,
		// but the resulting DOM changes do reach the observer. hashchange
		// covers hash-routed older versions.
		window.addEventListener('hashchange', scheduleScan);
		scheduleScan();
	}

	// Activation: wait for the Deck bundle (it sets window.OCA.Deck
	// after mounting). On non-Deck pages this never becomes true and the
	// script gives up after ~30s without ever touching the DOM.
	var attempts = 0;
	var timer = window.setInterval(function () {
		attempts++;
		var deckReady = (typeof OCA === 'object' && OCA !== null && !!OCA.Deck);
		if (deckReady || attempts > 150) {
			window.clearInterval(timer);
			debugLog(deckReady ? 'window.OCA.Deck found' : 'gave up waiting for window.OCA.Deck');
		}
		if (deckReady) {
			start();
		}
	}, 200);
})();
