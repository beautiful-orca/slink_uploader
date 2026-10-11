<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Controller;

use OCA\SlinkUploader\Service\MenuService;
use OCA\SlinkUploader\Service\SlinkService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IConfig;
use OCP\IGroupManager;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IUserSession;

class ConfigController extends Controller {

	public function __construct(
		string $appName,
		IRequest $request,
		private IConfig $config,
		private MenuService $menuService,
		private IGroupManager $groupManager,
		private IUserSession $userSession,
		private IL10N $l,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * Store the Slink connection settings. Admin only.
	 * @param string $endpoint
	 * @param string $token
	 * @param string $responseField
	 * @param string $fileFormName
	 * @param string $origin
	 * @param string $menuEntries JSON array of {name, params} context-menu entries
	 */
	public function save(string $endpoint, string $token, string $responseField = 'url', string $fileFormName = 'image', string $origin = '', string $menuEntries = ''): JSONResponse {
		$user = $this->userSession->getUser();
		if ($user === null || !$this->groupManager->isAdmin($user->getUID())) {
			return new JSONResponse(['error' => 'forbidden'], 403);
		}

		$endpoint = trim($endpoint);
		if ($endpoint === '') {
			return new JSONResponse(['error' => 'invalidendpoint', 'message' => $this->l->t('The API endpoint is required.')], 400);
		}
		if (preg_match('#^https?://#i', $endpoint) !== 1 || filter_var($endpoint, FILTER_VALIDATE_URL) === false) {
			return new JSONResponse(['error' => 'invalidendpoint', 'message' => $this->l->t('The API endpoint must be a full http(s) URL.')], 400);
		}

		$token = SlinkService::normalizeToken($token);
		if ($token !== '' && strcasecmp($token, 'Bearer') === 0) {
			return new JSONResponse(['error' => 'invalidtoken', 'message' => $this->l->t('The token must contain the API key, not just the "Bearer" prefix.')], 400);
		}

		$responseField = trim($responseField);
		if ($responseField === '') {
			$responseField = 'url';
		} elseif (preg_match('/^[\w.\-]+$/u', $responseField) !== 1) {
			return new JSONResponse(['error' => 'invalidresponsefield', 'message' => $this->l->t('The response field may only contain letters, digits, dots, underscores and dashes.')], 400);
		}

		$fileFormName = trim($fileFormName);
		if ($fileFormName === '') {
			$fileFormName = 'image';
		} elseif (preg_match('/^[\w\-]+$/u', $fileFormName) !== 1) {
			return new JSONResponse(['error' => 'invalidfileformname', 'message' => $this->l->t('The file form name may only contain letters, digits, underscores and dashes.')], 400);
		}

		$origin = trim($origin);
		if ($origin !== '' && (preg_match('#^https?://#i', $origin) !== 1 || filter_var($origin, FILTER_VALIDATE_URL) === false)) {
			return new JSONResponse(['error' => 'invalidorigin', 'message' => $this->l->t('The origin must be a full http(s) URL or empty.')], 400);
		}

		$this->config->setAppValue('slink_uploader', 'endpoint', $endpoint);
		$this->config->setAppValue('slink_uploader', 'token', $token);
		$this->config->setAppValue('slink_uploader', 'responseField', $responseField);
		$this->config->setAppValue('slink_uploader', 'fileFormName', $fileFormName);
		$this->config->setAppValue('slink_uploader', 'origin', $origin);

		// An empty/missing menuEntries value leaves the existing entries
		// untouched; '[]' explicitly removes all entries.
		if ($menuEntries !== '') {
			try {
				$this->menuService->saveEntries($this->menuService->parseEntriesJson($menuEntries));
			} catch (\InvalidArgumentException $e) {
				return new JSONResponse(['error' => 'invalidentries', 'message' => $e->getMessage()], 400);
			}
		}

		return new JSONResponse(['status' => 'saved']);
	}
}
