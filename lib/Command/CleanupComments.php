<?php

declare(strict_types=1);

namespace OCA\SlinkUploader\Command;

use OCP\Comments\ICommentsManager;
use OCP\IDBConnection;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * occ slink_uploader:cleanup-comments [--dry-run]
 *
 * Deletes all comments the app created on files (every comment message
 * starting with the "Slink" marker, whatever the format version), so a
 * test installation can be reset to a clean state.
 */
class CleanupComments extends Command {

	private const MARKER = 'Slink';

	public function __construct(
		private IDBConnection $db,
		private ICommentsManager $commentsManager,
	) {
		parent::__construct();
	}

	protected function configure(): void {
		$this->setName('slink_uploader:cleanup-comments');
		$this->setDescription('Delete all comments created by the Slink Uploader app');
		$this->addOption('dry-run', null, InputOption::VALUE_NONE, 'Only list the matching comments, do not delete');
	}

	protected function execute(InputInterface $input, OutputInterface $output): int {
		$dryRun = (bool)$input->getOption('dry-run');

		$query = $this->db->getQueryBuilder();
		$query->select('id')
			->from('comments')
			->where($query->expr()->eq('object_type', $query->createNamedParameter('files')))
			->andWhere($query->expr()->like('message', $query->createNamedParameter(self::MARKER . '%')));
		$result = $query->executeQuery();

		$count = 0;
		while (($row = $result->fetch()) !== false) {
			try {
				$comment = $this->commentsManager->get((string)$row['id']);
			} catch (\Throwable $e) {
				$output->writeln('<error>Could not load comment ' . $row['id'] . ': ' . $e->getMessage() . '</error>');
				continue;
			}
			$output->writeln(
				($dryRun ? 'would delete' : 'deleted')
				. ' comment ' . $comment->getId()
				. ' on file ' . $comment->getObjectId()
				. ' (' . $comment->getMessage() . ')'
			);
			if (!$dryRun) {
				$this->commentsManager->delete($comment);
			}
			$count++;
		}
		$result->closeCursor();

		$output->writeln(($dryRun ? 'Found ' : 'Deleted ') . $count . ' Slink comment(s).');
		return 0;
	}
}
