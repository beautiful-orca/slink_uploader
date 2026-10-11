<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Service;

use OCP\Comments\ICommentsManager;

/**
 * Keeps one "Slink - <entry name>: <url>" comment per file, user and
 * context-menu entry, so every upload method has its own short comment
 * in the Files sidebar. Re-uploading through the same entry updates
 * that entry's comment; other entries' comments are left alone.
 *
 * Uses ICommentsManager::create()/save() — the createComment()/
 * saveComment() aliases were deprecated in NC 24 and removed since.
 * The verb is set explicitly to 'comment' because the Files sidebar
 * only lists comments with that verb (the Comment class defaults to
 * an empty verb).
 */
class CommentService {

	private const MARKER = 'Slink - ';
	private const VERB = 'comment';

	/** A whole comment message: "Slink - <entry name>: <url>" */
	private const MESSAGE_PATTERN = '/^Slink - (.+): (\S+)$/u';

	public function __construct(
		private ICommentsManager $commentsManager,
	) {
	}

	/**
	 * @return string 'created' or 'updated'
	 */
	public function upsert(string $userId, int $fileId, string $url, string $entryName): string {
		$entryName = trim($entryName);
		$message = self::MARKER . $entryName . ': ' . $url;

		$comments = $this->commentsManager->getForObject('files', (string)$fileId);
		foreach ($comments as $comment) {
			if ($comment->getActorType() === 'users'
				&& $comment->getActorId() === $userId
				&& $this->parseEntryName($comment->getMessage()) === $entryName) {
				$comment->setMessage($message);
				$comment->setVerb(self::VERB);
				$this->commentsManager->save($comment);
				return 'updated';
			}
		}

		$comment = $this->commentsManager->create('users', $userId, 'files', (string)$fileId);
		$comment->setMessage($message);
		$comment->setVerb(self::VERB);
		$this->commentsManager->save($comment);
		return 'created';
	}

	/**
	 * Base share URL (query string stripped) of any Slink URL previously
	 * stored by the user for this file, or null if none is known. Used to
	 * recover the share link when Slink rejects a re-upload of an
	 * unchanged image as a duplicate. Any entry's comment works: they
	 * all point to the same hosted image.
	 */
	public function findBaseUrl(string $userId, int $fileId): ?string {
		$comments = $this->commentsManager->getForObject('files', (string)$fileId);
		foreach ($comments as $comment) {
			if ($comment->getActorType() !== 'users' || $comment->getActorId() !== $userId) {
				continue;
			}
			if (preg_match(self::MESSAGE_PATTERN, $comment->getMessage(), $matches) === 1) {
				return preg_replace('/[?#].*$/', '', $matches[2]);
			}
		}
		return null;
	}

	private function parseEntryName(string $message): ?string {
		if (preg_match(self::MESSAGE_PATTERN, $message, $matches) === 1) {
			return $matches[1];
		}
		return null;
	}
}
