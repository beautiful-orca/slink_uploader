<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Settings;

use OCA\SlinkUploader\Service\MenuService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IConfig;
use OCP\Settings\ISettings;
use OCP\Util;

class Admin implements ISettings {

	public function __construct(
		private IConfig $config,
		private MenuService $menuService,
	) {
	}

	public function getForm(): TemplateResponse {
		// The form JS must live in a file: Nextcloud's CSP blocks the
		// inline <script> previously embedded in the template.
		Util::addScript('slink_uploader', 'admin-settings');
		$params = [
			'endpoint' => $this->config->getAppValue('slink_uploader', 'endpoint', ''),
			'token' => $this->config->getAppValue('slink_uploader', 'token', ''),
			'responseField' => $this->config->getAppValue('slink_uploader', 'responseField', 'url'),
			'fileFormName' => $this->config->getAppValue('slink_uploader', 'fileFormName', 'image'),
			'origin' => $this->config->getAppValue('slink_uploader', 'origin', ''),
			'menuEntries' => $this->menuService->getEntries(),
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
