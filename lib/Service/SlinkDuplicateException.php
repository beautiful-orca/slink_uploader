<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Service;

/**
 * Thrown when the Slink API rejects an upload because the exact image
 * is already hosted there (DuplicateImageException, HTTP 400). The
 * share URL of the existing image can then be reused instead of
 * failing the upload.
 */
class SlinkDuplicateException extends \RuntimeException {
}
