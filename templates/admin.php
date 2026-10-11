<?php

declare(strict_types=1);

/** @var array $_ */
?>
<div class="section" id="slink-uploader-settings">
	<p class="settings-hint">
		<?php p($l->t('Configure the image hosting instance images are uploaded to. All connection values come from the Slink API information (e.g. the ShareX profile) and are entered here; nothing is hard-coded in the app.')); ?>
	</p>

	<form id="slink-uploader-form" autocomplete="off">
		<p>
			<label for="slink-endpoint"><?php p($l->t('API endpoint (full URL)')); ?></label><br />
			<input type="url" id="slink-endpoint" name="endpoint" autocomplete="off" required
				placeholder="https://slink.example.com/api/upload"
				value="<?php p($_['endpoint']); ?>" style="width: 100%; max-width: 480px;" />
		</p>
		<p>
			<label for="slink-token"><?php p($l->t('Bearer token (optional)')); ?></label><br />
			<input type="password" id="slink-token" name="token" autocomplete="new-password"
				value="<?php p($_['token']); ?>" style="width: 100%; max-width: 480px;" />
			<br /><span class="settings-hint"><?php p($l->t('You can paste the whole value including "Bearer "; the prefix is stripped automatically.')); ?></span>
		</p>
		<p>
			<label for="slink-response-field"><?php p($l->t('Response field containing the URL')); ?></label><br />
			<input type="text" id="slink-response-field" name="responseField" autocomplete="off"
				pattern="[\w.\-]*" placeholder="url" value="<?php p($_['responseField']); ?>" />
		</p>
		<p>
			<label for="slink-file-form-name"><?php p($l->t('File form name in the multipart request')); ?></label><br />
			<input type="text" id="slink-file-form-name" name="fileFormName" autocomplete="off"
				pattern="[\w\-]*" placeholder="image" value="<?php p($_['fileFormName']); ?>" />
		</p>
		<p>
			<label for="slink-origin"><?php p($l->t('Origin header (optional, derived from the endpoint URL if empty)')); ?></label><br />
			<input type="url" id="slink-origin" name="origin" autocomplete="off"
				placeholder="https://img.example.com" value="<?php p($_['origin']); ?>" style="width: 100%; max-width: 480px;" />
		</p>

		<h3><?php p($l->t('Context menu entries')); ?></h3>
		<p class="settings-hint">
			<?php p($l->t('Each entry creates its own action in the files context menu. The URL parameters are appended to the share URL returned by Slink, e.g. "width=1200&format=jpeg". Without entries, a single "Upload to Slink" action without parameters is shown.')); ?>
		</p>
		<table id="slink-entries-table" style="max-width: 640px;">
			<thead>
				<tr>
					<th style="text-align: left;"><?php p($l->t('Displayed name')); ?></th>
					<th style="text-align: left;"><?php p($l->t('URL parameters')); ?></th>
					<th></th>
				</tr>
			</thead>
			<tbody id="slink-entries-body">
				<?php foreach ($_['menuEntries'] as $entry): ?>
				<tr class="slink-entry-row">
					<td><input type="text" class="entry-name" autocomplete="off" placeholder="<?php p($l->t('Title image')); ?>" value="<?php p($entry['name']); ?>" /></td>
					<td><input type="text" class="entry-params" autocomplete="off" placeholder="width=1200&format=jpeg" value="<?php p($entry['params']); ?>" style="min-width: 220px;" /></td>
					<td><button type="button" class="slink-remove-entry button"><?php p($l->t('Remove')); ?></button></td>
				</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
		<p>
			<button type="button" id="slink-add-entry" class="button"><?php p($l->t('Add entry')); ?></button>
		</p>
		<input type="hidden" name="menuEntries" id="slink-menu-entries" value="[]" />
		<p>
			<button type="submit" class="button primary"><?php p($l->t('Save')); ?></button>
			<span id="slink-uploader-status"></span>
		</p>
	</form>
</div>

