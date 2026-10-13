<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Service;

use OCP\Files\File;
use Psr\Log\LoggerInterface;

/**
 * Limits the width and/or converts images to JPEG for the Slink upload,
 * using PHP GD.
 *
 * The original file in Nextcloud is never touched: the processed copy
 * only exists in memory for the duration of the upload request.
 *
 * Failsafe: whenever GD is unavailable or processing fails for any
 * reason (unsupported format, broken image, memory limit, ...), null is
 * returned and the caller uploads the untouched original instead of
 * aborting the request.
 */
class ImageService {

	public const APP_ID = 'slink_uploader';

	private const JPEG_QUALITY_DEFAULT = 85;
	private const MAX_WIDTH_LIMIT = 20000;

	private ?\GdImage $source = null;
	private ?\GdImage $destination = null;

	public function __construct(
		private LoggerInterface $logger,
	) {
	}

	/**
	 * @param int $maxWidth maximum width in pixels; 0 = no limit
	 * @param bool $convertToJpg convert the image to JPEG
	 * @param int $quality JPEG quality in percent; 0 = default (85)
	 * @return null|array{data: string, filename: string, mimeType: string}
	 *         null = upload the original unchanged
	 */
	public function process(File $file, int $maxWidth, bool $convertToJpg, int $quality = 0): ?array {
		if ($maxWidth <= 0 && !$convertToJpg) {
			return null;
		}
		if ($maxWidth < 0 || $maxWidth > self::MAX_WIDTH_LIMIT) {
			$maxWidth = 0;
		}
		$quality = ($quality >= 1 && $quality <= 100) ? $quality : self::JPEG_QUALITY_DEFAULT;
		if (!function_exists('imagecreatetruecolor')) {
			$this->logger->debug('PHP GD is not available; uploading the original image.', [
				'app' => self::APP_ID,
			]);
			return null;
		}

		try {
			return $this->doProcess($file, $maxWidth, $convertToJpg, $quality);
		} catch (\Throwable $e) {
			$this->logger->warning('Could not process image for the Slink upload, falling back to the original: ' . $e->getMessage(), [
				'app' => self::APP_ID,
				'fileId' => $file->getId(),
			]);
			return null;
		} finally {
			$this->cleanup();
		}
	}

	private function doProcess(File $file, int $maxWidth, bool $convertToJpg, int $quality): ?array {
		$source = @imagecreatefromstring($file->getContent());
		if (!$source instanceof \GdImage) {
			// Not an image or a format this GD build cannot decode.
			return null;
		}
		$this->source = $source;

		$width = imagesx($this->source);
		$height = imagesy($this->source);
		if ($width < 1 || $height < 1) {
			return null;
		}

		$mimeType = $file->getMimeType();
		$needsResize = $maxWidth > 0 && $width > $maxWidth;

		// Nothing to change, or a JPEG that would only be re-encoded
		// at a loss without any benefit: keep the original.
		if (!$needsResize && (!$convertToJpg || $mimeType === 'image/jpeg')) {
			return null;
		}

		$output = $convertToJpg ? 'jpeg' : $this->encoderFor($mimeType);
		if ($output === null) {
			return null;
		}

		$newWidth = $needsResize ? $maxWidth : $width;
		$newHeight = $needsResize ? (int)round($height * $maxWidth / $width) : $height;

		$destination = imagecreatetruecolor($newWidth, $newHeight);
		if ($destination === false) {
			return null;
		}
		$this->destination = $destination;

		if ($convertToJpg) {
			// Transparent areas would turn black in JPEG; fill white.
			$white = imagecolorallocate($destination, 255, 255, 255);
			if ($white !== false) {
				imagefill($destination, 0, 0, $white);
			}
		} elseif (in_array($mimeType, ['image/png', 'image/gif', 'image/webp'], true)) {
			imagealphablending($destination, false);
			imagesavealpha($destination, true);
		}

		if (imagecopyresampled($destination, $this->source, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height) !== true) {
			return null;
		}

		$data = $this->encode($destination, $output, $quality);
		if ($data === null) {
			return null;
		}

		return [
			'data' => $data,
			'filename' => $convertToJpg ? $this->jpgFilename($file->getName()) : $file->getName(),
			'mimeType' => $convertToJpg ? 'image/jpeg' : $mimeType,
		];
	}

	/**
	 * GD encoder matching the source mime type (when only the width is
	 * limited): keep the format, null if this GD build cannot encode it.
	 */
	private function encoderFor(string $mimeType): ?string {
		return match ($mimeType) {
			'image/jpeg' => function_exists('imagejpeg') ? 'jpeg' : null,
			'image/png' => function_exists('imagepng') ? 'png' : null,
			'image/gif' => function_exists('imagegif') ? 'gif' : null,
			'image/webp' => function_exists('imagewebp') ? 'webp' : null,
			default => null,
		};
	}

	private function encode(\GdImage $image, string $format, int $quality): ?string {
		ob_start();
		try {
			$ok = match ($format) {
				'jpeg' => imagejpeg($image, null, $quality),
				'png' => imagepng($image, null),
				'gif' => imagegif($image, null),
				'webp' => imagewebp($image, null, $quality),
				default => false,
			};
		} catch (\Throwable $e) {
			ob_end_clean();
			return null;
		}
		$data = (string)ob_get_clean();
		if ($ok !== true || $data === '') {
			return null;
		}
		return $data;
	}

	/**
	 * "photo.png" → "photo.jpg"; files without an extension get ".jpg"
	 * appended.
	 */
	private function jpgFilename(string $name): string {
		$extension = pathinfo($name, PATHINFO_EXTENSION);
		if ($extension === '') {
			return $name . '.jpg';
		}
		return substr($name, 0, -strlen($extension)) . 'jpg';
	}

	private function cleanup(): void {
		if ($this->source instanceof \GdImage) {
			imagedestroy($this->source);
			$this->source = null;
		}
		if ($this->destination instanceof \GdImage) {
			imagedestroy($this->destination);
			$this->destination = null;
		}
	}
}
