<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Settings;

use OCA\SlinkUploader\Service\MenuService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IConfig;
use OCP\Settings\ISettings;
use OCP\Util;
use Psr\Log\LoggerInterface;

class Admin implements ISettings {

	public function __construct(
		private IConfig $config,
		private MenuService $menuService,
		private LoggerInterface $logger,
	) {
	}

	public function getForm(): TemplateResponse {
		// The form JS must live in a file: Nextcloud's CSP blocks the
		// inline <script> previously embedded in the template.
		Util::addScript('slink_uploader', 'admin-settings');
		Util::addStyle('slink_uploader', 'admin-settings');

		// The settings page must never fail as a whole because of the
		// entry list (e.g. an inconsistent app update or unexpected
		// config data): fall back to an empty list and log the cause.
		$entries = [];
		try {
			$entries = $this->menuService->getEntries();
		} catch (\Throwable $e) {
			$this->logger->error('Could not load the Slink Uploader context-menu entries, showing an empty list instead: ' . $e->getMessage(), [
				'app' => 'slink_uploader',
				'exception' => $e,
			]);
		}

		$params = [
			'endpoint' => $this->config->getAppValue('slink_uploader', 'endpoint', ''),
			'token' => $this->config->getAppValue('slink_uploader', 'token', ''),
			'responseField' => $this->config->getAppValue('slink_uploader', 'responseField', 'url'),
			'fileFormName' => $this->config->getAppValue('slink_uploader', 'fileFormName', 'image'),
			'origin' => $this->config->getAppValue('slink_uploader', 'origin', ''),
			'menuEntries' => $entries,
		];
		return new TemplateResponse('slink_uploader', 'admin', $params);
	}

	public function getSection(): string {
		return 'slink_uploader';
	}

	public function getPriority(): int {
		return 80;
	}
}
