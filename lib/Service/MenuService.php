<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Service;

use OCP\IConfig;
use OCP\IL10N;

/**
 * Handles the configurable context-menu entries of the Files app.
 *
 * Each entry consists of a display name (shown in the context menu) and
 * optional URL parameters that are appended to the share URL returned by
 * Slink, e.g. name "Title image", params "width=1200&format=jpeg".
 *
 * The entries are stored as a JSON array in the app config and are fully
 * admin-configurable; nothing is hard-coded in the app.
 */
class MenuService {

	public const APP_ID = 'slink_uploader';

	private const MAX_ENTRIES = 20;
	private const MAX_NAME_LENGTH = 64;
	private const MAX_PARAMS_LENGTH = 256;

	/** Characters allowed in the URL parameters (query-style, without leading ? or &) */
	private const PARAMS_PATTERN = '/^[\w&=%._~:\-,\/]+$/u';

	public function __construct(
		private IConfig $config,
		private IL10N $l,
	) {
	}

	/**
	 * @return list<array{name: string, params: string}>
	 */
	public function getEntries(): array {
		$decoded = json_decode($this->config->getAppValue(self::APP_ID, 'menuEntries', '[]'), true);
		if (!is_array($decoded)) {
			return [];
		}

		$entries = [];
		foreach ($decoded as $entry) {
			if (is_array($entry)
				&& isset($entry['name'], $entry['params'])
				&& is_string($entry['name']) && is_string($entry['params'])) {
				$entries[] = ['name' => $entry['name'], 'params' => $entry['params']];
			}
		}
		return $entries;
	}

	/**
	 * Validate and normalize the JSON representation of the entry list
	 * coming from the admin settings form.
	 *
	 * @return list<array{name: string, params: string}>
	 * @throws \InvalidArgumentException on invalid JSON or invalid entry data
	 */
	public function parseEntriesJson(string $json): array {
		$decoded = json_decode($json, true);
		if (!is_array($decoded)) {
			throw new \InvalidArgumentException($this->l->t('Entries must be a JSON array.'));
		}

		$entries = [];
		foreach ($decoded as $entry) {
			if (!is_array($entry) || !isset($entry['name'])) {
				continue;
			}
			$name = mb_substr(trim((string)$entry['name']), 0, self::MAX_NAME_LENGTH);
			if ($name === '') {
				continue;
			}
			$params = trim((string)($entry['params'] ?? ''));
			if ($params !== '') {
				$params = mb_substr(ltrim($params, '?&'), 0, self::MAX_PARAMS_LENGTH);
			}
			if ($params !== '' && preg_match(self::PARAMS_PATTERN, $params) !== 1) {
				throw new \InvalidArgumentException($this->l->t('Invalid URL parameters for entry "%s".', [$name]));
			}
			$entries[] = ['name' => $name, 'params' => $params];
		}

		if (count($entries) > self::MAX_ENTRIES) {
			throw new \InvalidArgumentException($this->l->t('Too many entries (max %d).', [self::MAX_ENTRIES]));
		}
		return $entries;
	}

	public function saveEntries(array $entries): void {
		$this->config->setAppValue(self::APP_ID, 'menuEntries', json_encode($entries) ?: '[]');
	}

	/**
	 * Append the given query parameters to a share URL, using '?' or '&'
	 * depending on whether the URL already contains a query part.
	 */
	public function appendParams(string $url, string $params): string {
		$params = ltrim(trim($params), '?&');
		if ($params === '') {
			return $url;
		}
		if (preg_match(self::PARAMS_PATTERN, $params) !== 1) {
			throw new \InvalidArgumentException($this->l->t('Invalid URL parameters.'));
		}
		return $url . (str_contains($url, '?') ? '&' : '?') . $params;
	}
}
