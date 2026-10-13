<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Service;

use OCP\IConfig;
use OCP\IL10N;

/**
 * Handles the configurable context-menu entries of the Files app.
 *
 * Each entry consists of a display name (shown in the context menu),
 * optional URL parameters that are appended to the share URL returned by
 * Slink, and upload processing options applied server-side before the
 * upload: maxWidth (maximum width in pixels, 0 = unlimited), toJpg
 * (convert the image to JPEG) and quality (JPEG quality in percent,
 * 0 = default 85). Entries stored by older versions of the app (without
 * the processing fields) keep working with the defaults 0/false/0.
 *
 * The entries are stored as a JSON array in the app config and are fully
 * admin-configurable; nothing is hard-coded in the app.
 */
class MenuService {

	public const APP_ID = 'slink_uploader';

	private const MAX_ENTRIES = 20;
	private const MAX_NAME_LENGTH = 64;
	private const MAX_PARAMS_LENGTH = 256;
	private const MAX_WIDTH_LIMIT = 20000;
	private const MAX_QUALITY = 100;

	/** Characters allowed in the URL parameters (query-style, without leading ? or &) */
	private const PARAMS_PATTERN = '/^[\w&=%._~:\-,\/]+$/u';

	public function __construct(
		private IConfig $config,
		private IL10N $l,
	) {
	}

	/**
	 * @return list<array{name: string, params: string, maxWidth: int, toJpg: bool, quality: int}>
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
				$entries[] = [
					'name' => $entry['name'],
					'params' => $entry['params'],
					'maxWidth' => self::normalizeMaxWidth($entry['maxWidth'] ?? 0),
					'toJpg' => self::normalizeToJpg($entry['toJpg'] ?? false),
					'quality' => self::normalizeQuality($entry['quality'] ?? 0),
				];
			}
		}
		return $entries;
	}

	/**
	 * The configured entry with the given display name (the same key the
	 * entry's comment is stored under), or null if no such entry exists.
	 */
	public function findEntry(string $name): ?array {
		foreach ($this->getEntries() as $entry) {
			if ($entry['name'] === trim($name)) {
				return $entry;
			}
		}
		return null;
	}

	/**
	 * Validate and normalize the JSON representation of the entry list
	 * coming from the admin settings form.
	 *
	 * @return list<array{name: string, params: string, maxWidth: int, toJpg: bool, quality: int}>
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
			$maxWidthRaw = $entry['maxWidth'] ?? 0;
			$maxWidth = is_int($maxWidthRaw) ? $maxWidthRaw : (is_numeric($maxWidthRaw) ? (int)$maxWidthRaw : -1);
			if ($maxWidth < 0 || $maxWidth > self::MAX_WIDTH_LIMIT) {
				throw new \InvalidArgumentException($this->l->t('Invalid maximum width for entry "%s" (0 to %d pixels).', [$name, self::MAX_WIDTH_LIMIT]));
			}
			$qualityRaw = $entry['quality'] ?? 0;
			$quality = is_int($qualityRaw) ? $qualityRaw : (is_numeric($qualityRaw) ? (int)$qualityRaw : -1);
			if ($quality < 0 || $quality > self::MAX_QUALITY) {
				throw new \InvalidArgumentException($this->l->t('Invalid JPEG quality for entry "%s" (0 for default, or 1 to %d percent).', [$name, self::MAX_QUALITY]));
			}
			$entries[] = [
				'name' => $name,
				'params' => $params,
				'maxWidth' => $maxWidth,
				'toJpg' => self::normalizeToJpg($entry['toJpg'] ?? false),
				'quality' => $quality,
			];
		}

		if (count($entries) > self::MAX_ENTRIES) {
			throw new \InvalidArgumentException($this->l->t('Too many entries (max %d).', [self::MAX_ENTRIES]));
		}
		return $entries;
	}

	public function saveEntries(array $entries): void {
		$this->config->setAppValue(self::APP_ID, 'menuEntries', json_encode($entries) ?: '[]');
	}

	private static function normalizeMaxWidth(mixed $value): int {
		if (is_int($value)) {
			$maxWidth = $value;
		} elseif (is_numeric($value)) {
			$maxWidth = (int)$value;
		} else {
			return 0;
		}
		return ($maxWidth >= 0 && $maxWidth <= self::MAX_WIDTH_LIMIT) ? $maxWidth : 0;
	}

	private static function normalizeToJpg(mixed $value): bool {
		return is_bool($value) ? $value : filter_var($value, FILTER_VALIDATE_BOOL);
	}

	private static function normalizeQuality(mixed $value): int {
		if (is_int($value)) {
			$quality = $value;
		} elseif (is_numeric($value)) {
			$quality = (int)$value;
		} else {
			return 0;
		}
		return ($quality >= 0 && $quality <= self::MAX_QUALITY) ? $quality : 0;
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
