<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\AppInfo;

use OCP\AppFramework\App;
use OCP\Util;

class Application extends App {

	public const APP_ID = 'slink_uploader';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);

		// The file-action registration must run early in the bootstrap
		// flow so the Files app picks it up (LoadAdditionalScriptsEvent
		// fires too late for that). Init scripts are loaded on every
		// page; the script itself only registers when a Files app
		// action channel is present.
		Util::addInitScript(self::APP_ID, 'slink_uploader-main');
	}
}
