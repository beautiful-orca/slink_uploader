<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Service;

use OCP\Files\File;
use OCP\Http\Client\IClientService;
use OCP\IConfig;
use OCP\IL10N;
use Psr\Log\LoggerInterface;

/**
 * Sends image files to a Slink image hosting instance via its HTTP API.
 *
 * Expected API contract (all values configurable in the admin settings,
 * e.g. from a Slink ShareX profile):
 *  - POST <endpoint> with a multipart/form-data upload, file part named
 *    after the configured file form name
 *  - optional headers "Origin: <origin>" (if not set, derived from the
 *    endpoint URL) and "Authorization: Bearer <token>"
 *  - JSON response containing the share URL under the configured response
 *    field, e.g. {"url": "https://img.example/abc123.jpg"}
 */
class SlinkService {

	public const APP_ID = 'slink_uploader';

	public function __construct(
		private IClientService $clientService,
		private IConfig $config,
		private LoggerInterface $logger,
		private IL10N $l,
	) {
	}

	public function upload(File $file): string {
		$endpoint = $this->config->getAppValue(self::APP_ID, 'endpoint', '');
		$token = self::normalizeToken($this->config->getAppValue(self::APP_ID, 'token', ''));
		$field = $this->config->getAppValue(self::APP_ID, 'responseField', 'url');
		$fileFormName = $this->config->getAppValue(self::APP_ID, 'fileFormName', 'image');
		$origin = $this->config->getAppValue(self::APP_ID, 'origin', '');

		if ($endpoint === '') {
			throw new \RuntimeException($this->l->t('The Slink endpoint is not configured. Set it under Administration settings.'));
		}

		$headers = [
			'Accept' => 'application/json',
		];
		if ($token !== '') {
			$headers['Authorization'] = 'Bearer ' . $token;
		}

		if ($origin === '') {
			$origin = $this->getOriginFromEndpoint($endpoint);
		}
		if ($origin !== '') {
			$headers['Origin'] = $origin;
		}

		$multipart = [
			[
				'name' => $fileFormName,
				'contents' => $file->fopen('rb'),
				'filename' => $file->getName(),
				'headers' => [
					'Content-Type' => $file->getMimeType(),
				],
			],
		];

		try {
			$response = $this->clientService->newClient()->post($endpoint, [
				'headers' => $headers,
				'multipart' => $multipart,
				'timeout' => 60,
			]);
		} catch (\Throwable $e) {
			if ($this->isDuplicateRejection($e)) {
				throw new SlinkDuplicateException($this->l->t('The image is already hosted on Slink (duplicate).'));
			}
			$this->logger->error('Slink upload request failed: ' . $e->getMessage(), ['app' => self::APP_ID]);
			throw new \RuntimeException($this->l->t('Could not reach the Slink API') . ': ' . $e->getMessage(), 0, $e);
		}

		$body = (string)$response->getBody();

		$data = json_decode($body, true);
		if (is_array($data)) {
			$url = $data[$field] ?? $data['url'] ?? null;
			if (is_string($url) && $url !== '') {
				return $this->absolutizeUrl(trim($url), $endpoint, $origin);
			}
		} elseif (filter_var(trim($body), FILTER_VALIDATE_URL) !== false) {
			// Plain-text response containing only the URL
			return trim($body);
		}

		$this->logger->warning('Slink response did not contain a share URL', [
			'app' => self::APP_ID,
			'body' => mb_substr($body, 0, 500),
		]);
		throw new \RuntimeException($this->l->t('The Slink response did not contain a share URL.'));
	}

	/**
	 * Detect Slink's duplicate-image rejection (DuplicateImageException,
	 * HTTP 400): Slink refuses re-uploads of an unchanged image instead
	 * of returning the existing image's URL.
	 */
	private function isDuplicateRejection(\Throwable $e): bool {
		$body = $e->getMessage();
		if (method_exists($e, 'getResponse')) {
			$response = $e->getResponse();
			if ($response !== null && method_exists($response, 'getBody')) {
				$body = (string)$response->getBody();
			}
		}
		return str_contains($body, 'DuplicateImageException');
	}

	/**
	 * Users may paste the whole "Authorization" value from the ShareX
	 * configuration ("Bearer sk_…"). Strip the scheme prefix so the app
	 * always sends exactly one "Bearer <token>" header.
	 */
	public static function normalizeToken(string $token): string {
		return trim((string)preg_replace('/^bearer\s+/i', '', trim($token)));
	}

	/**
	 * Derive the Origin header value (scheme + host [+ port]) from the
	 * endpoint URL, mirroring the Origin header of the Slink ShareX profile.
	 */
	private function getOriginFromEndpoint(string $endpoint): string {
		$parts = parse_url($endpoint);
		if (!isset($parts['scheme'], $parts['host'])) {
			return '';
		}
		$origin = $parts['scheme'] . '://' . $parts['host'];
		if (isset($parts['port'])) {
			$origin .= ':' . $parts['port'];
		}
		return $origin;
	}

	/**
	 * Some Slink instances return the share URL as a relative path
	 * (e.g. "image/<id>" or "/image/<id>") instead of an absolute URL.
	 * Prefix it with the configured origin (or the endpoint's scheme and
	 * host) so toast, clipboard and comment always contain a full URL.
	 */
	private function absolutizeUrl(string $url, string $endpoint, string $origin): string {
		if (preg_match('#^[a-z][a-z0-9+.\-]*://#i', $url) === 1) {
			return $url;
		}
		if (str_starts_with($url, '//')) {
			// Protocol-relative URL: take the scheme from the endpoint
			$parts = parse_url($endpoint);
			return ($parts['scheme'] ?? 'https') . ':' . $url;
		}
		$base = ($origin !== '') ? $origin : $this->getOriginFromEndpoint($endpoint);
		if ($base === '') {
			return $url;
		}
		return rtrim($base, '/') . '/' . ltrim($url, '/');
	}
}
