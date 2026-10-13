<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\AppInfo;

use OCP\AppFramework\App;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\EventDispatcher\IEventDispatcher;
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

		// Deck integration: js/slink_uploader-deck.js injects the
		// "Upload to Slink" action into the attachment rows of the card
		// sidebar. It is loaded on every page (Deck has no frontend
		// hook to target its pages specifically) but stays idle until
		// window.OCA.Deck appears, which only happens on Deck pages.
		$container = $this->getContainer();
		/** @var IEventDispatcher $dispatcher */
		$dispatcher = $container->get(IEventDispatcher::class);
		$dispatcher->addListener(BeforeTemplateRenderedEvent::class, static function (BeforeTemplateRenderedEvent $event) use ($container): void {
			if (!$event->isLoggedIn()) {
				return;
			}
			if (!$container->get(\OCP\App\IAppManager::class)->isEnabledForUser('deck')) {
				return;
			}
			Util::addScript(self::APP_ID, 'slink_uploader-deck');
		});
	}
}
