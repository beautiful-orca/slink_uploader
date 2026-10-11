<?php

declare(strict_types=1);

return [
	'routes' => [
		['name' => 'upload#upload', 'url' => '/upload', 'verb' => 'POST'],
		['name' => 'upload#entries', 'url' => '/entries', 'verb' => 'GET'],
		['name' => 'config#save', 'url' => '/config', 'verb' => 'POST'],
	],
];
