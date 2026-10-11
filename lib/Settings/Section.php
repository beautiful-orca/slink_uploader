<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Settings;

use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\Settings\IIconSection;

class Section implements IIconSection {

	public function __construct(
		private IL10N $l,
		private IURLGenerator $urlGenerator,
	) {
	}

	public function getID(): string {
		return 'slink_uploader';
	}

	public function getName(): string {
		return $this->l->t('Slink Uploader');
	}

	public function getPriority(): int {
		return 80;
	}

	public function getIcon(): string {
		return $this->urlGenerator->imagePath('slink_uploader', 'app.svg');
	}
}
