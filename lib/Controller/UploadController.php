<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Controller;

use OCA\SlinkUploader\Service\CommentService;
use OCA\SlinkUploader\Service\MenuService;
use OCA\SlinkUploader\Service\SlinkDuplicateException;
use OCA\SlinkUploader\Service\SlinkService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\JSONResponse;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IUserSession;
use Psr\Log\LoggerInterface;

class UploadController extends Controller {

	public function __construct(
		string $appName,
		IRequest $request,
		private IRootFolder $rootFolder,
		private IUserSession $userSession,
		private SlinkService $slinkService,
		private CommentService $commentService,
		private MenuService $menuService,
		private IL10N $l10n,
		private LoggerInterface $logger,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * Return the configured context-menu entries (name + URL parameters)
	 * for the frontend file actions.
	 *
	 * @NoAdminRequired
	 */
	public function entries(): JSONResponse {
		return new JSONResponse(['entries' => $this->menuService->getEntries()]);
	}

	/**
	 * Upload the given file to Slink and store the returned URL as a comment.
	 * $params contains the URL parameters and $name the display name of the
	 * chosen context-menu entry (used to key the entry's line in the comment).
	 *
	 * @NoAdminRequired
	 * @param int $fileId
	 * @param string $params
	 * @param string $name
	 */
	public function upload(int $fileId, string $params = '', string $name = ''): JSONResponse {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return new JSONResponse(['error' => 'notloggedin'], 401);
		}
		$userId = $user->getUID();

		$userFolder = $this->rootFolder->getUserFolder($userId);
		$nodes = $userFolder->getById($fileId);
		$node = $nodes[0] ?? null;

		if (!($node instanceof File)) {
			return new JSONResponse(['error' => 'notfound'], 404);
		}

		$mimeType = $node->getMimeType();
		if (str_starts_with($mimeType, 'image/') === false) {
			return new JSONResponse(['error' => 'notanimage', 'mime' => $mimeType], 400);
		}

		$name = trim($name);
		if ($name === '') {
			return new JSONResponse([
				'error' => 'invalidname',
				'message' => $this->l10n->t('The name of the context-menu entry is required.'),
			], 400);
		}

		// Slink rejects re-uploads of an unchanged image as duplicates
		// instead of returning the existing image's URL. The base URL is
		// already known from a previous upload of this file (stored in
		// its comment), so reuse it instead of failing the request.
		$duplicate = false;
		try {
			$url = $this->slinkService->upload($node);
		} catch (SlinkDuplicateException $e) {
			$baseUrl = $this->commentService->findBaseUrl($userId, $fileId);
			if ($baseUrl === null) {
				$this->logger->warning('Slink rejected file ' . $fileId . ' as a duplicate, and no previously stored Slink URL is available to recover from.', [
					'app' => 'slink_uploader',
				]);
				return new JSONResponse([
					'error' => 'duplicate',
					'message' => $e->getMessage() . ' '
						. $this->l10n->t('No previously stored Slink URL of this file is known, so the link cannot be reused here. Copy the URL of the existing image on Slink instead.'),
				], 409);
			}
			$duplicate = true;
			$url = $baseUrl;
		} catch (\Throwable $e) {
			$this->logger->error('Slink upload failed for file ' . $fileId . ': ' . $e->getMessage(), [
				'app' => 'slink_uploader',
				'exception' => $e,
			]);
			return new JSONResponse(['error' => 'uploadfailed', 'message' => $e->getMessage()], 502);
		}

		try {
			$url = $this->menuService->appendParams($url, $params);
		} catch (\InvalidArgumentException $e) {
			return new JSONResponse(['error' => 'invalidparams', 'message' => $e->getMessage()], 400);
		}

		$commentState = 'skipped';
		try {
			$commentState = $this->commentService->upsert($userId, $fileId, $url, $name);
		} catch (\Throwable $e) {
			$this->logger->warning('Could not upsert Slink comment on file ' . $fileId . ': ' . $e->getMessage(), [
				'app' => 'slink_uploader',
			]);
		}

		return new JSONResponse([
			'url' => $url,
			'fileName' => $node->getName(),
			'comment' => $commentState,
			'duplicate' => $duplicate,
		]);
	}
}
