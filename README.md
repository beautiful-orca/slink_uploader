# Slink Uploader

A build-free Nextcloud app (NC 30–34) that adds **"Upload to Slink"**
actions for image files to the context menu (three-dot menu) of the Files
app. The image is uploaded to a self-hosted
[Slink](https://github.com/andrii-kryvoviaz/slink) image host; the returned
share URL is copied to the clipboard and stored as a comment on the file.
Multiple context-menu entries (e.g. different image sizes) are
admin-configurable.

## What happens on click

1. The image is processed server-side according to the chosen
   context-menu entry: if the entry sets a maximum width, larger images
   are scaled down proportionally; if the entry enables JPEG conversion,
   the image is converted to JPEG with the entry's quality in percent
   (default 85; transparent areas filled white). Processing uses PHP GD,
   happens only in memory and never touches the original file in
   Nextcloud — only the Slink upload uses the processed copy. Failsafe:
   if GD is unavailable or processing fails for any reason (unsupported
   format, broken image, memory limit), the original is uploaded
   instead; processing never aborts the upload.
2. The image is sent server-side (in the context of the logged-in user) to
   the configured Slink API: a multipart POST with the values stored in the
   administration settings (endpoint, file form name, Origin header, Bearer
   token). The URL parameters of the chosen context-menu entry are appended
   to the returned share URL.
3. The returned share URL is
   - copied to the **clipboard** (with a toast confirmation) and
   - stored as a **comment** on the file. Each context-menu entry keeps its
     own comment of the form `Slink - <entry name>: <URL>`. Re-uploading
     through an entry updates that entry's comment; the comments of other
     entries are left untouched.
4. Slink deduplicates images. When an unchanged image is re-uploaded (e.g.
   a second entry used on the same file), Slink rejects the upload with
   `DuplicateImageException` (HTTP 400) instead of returning the existing
   image's URL. The app handles this transparently: it reuses the base
   share URL from the file's existing Slink comments (query string
   stripped), appends the current entry's parameters and still returns the
   correct URL — the toast notes that the link of the already uploaded
   image was reused. Only if no URL of the file is known (e.g. the
   duplicate was uploaded outside this app), the request fails with a
   clear "duplicate" error.
5. All of this happens without WebDAV detours and without shell access — so
   it also works on managed instances (e.g. Hetzner Storage Share;
   installation there via AppDrop, see "Installation").

## Configuration

All connection values come from the Slink API information (e.g. the ShareX
configuration that Slink provides under External Integrations) and are
stored exclusively in the app settings — nothing is hard-coded.

Administration settings → **Slink Uploader** (the app has its own section):

| Field            | Meaning                                                                  |
|------------------|--------------------------------------------------------------------------|
| API endpoint     | Full URL of the upload endpoint, e.g. `https://img.example.com/api/external/upload` |
| Bearer token     | Optional `Authorization: Bearer <token>` header; a pasted "Bearer " prefix is stripped automatically |
| Response field   | JSON field in the response that contains the share URL (default: `url`)  |
| File form name   | Name of the file part in the multipart request (default: `image`)        |
| Origin header    | Optional `Origin` header; if empty, it is derived automatically from scheme + host of the endpoint URL |

All fields are validated on save: the API endpoint is required and must be a
full `http(s)://` URL; the response field may only contain letters, digits,
dots, underscores and dashes; the file form name only letters, digits,
underscores and dashes; the origin must be a full `http(s)://` URL or empty;
and a token consisting only of the `Bearer` prefix is rejected (the prefix
itself is stripped automatically).

Expected Slink response: `{"url": "https://…/image.jpg"}` (field name
configurable). A plain-text response containing only the URL is also
accepted. If Slink returns only a relative path (e.g. `image/<id>`), it is
automatically completed to a full URL using the Origin header (or the
endpoint's scheme and host).

### Creating an API key in Slink

The connection values originate in Slink itself — the API key is created
there and the ShareX configuration is obtained from it:

1. In the Slink web interface, open your profile and go to **External
   Integrations** (`https://<slink-host>/integrations`).
2. Create an **API key** there.
3. Download the **ShareX configuration** from the same page — it contains
   the API URL and the Bearer token and is transferred field by field into
   the app settings (see below).

Optional: If images uploaded via the API should be published automatically,
enable the **Auto-publish API uploads** option in the Slink preferences
(`https://<slink-host>/preferences`).

### Transferring a ShareX configuration

Slink provides a ShareX configuration ("API Information") as JSON under
**External Integrations** (see above). Its values are transferred field by
field to the app settings:

| ShareX field             | Example value                                            | App setting      |
|-------------------------|----------------------------------------------------------|------------------|
| `RequestURL`            | `https://img.example.com/api/external/upload`            | API endpoint     |
| `Authorization`         | `Bearer sk_…` — the whole value can be pasted; the app strips the `Bearer ` prefix | Bearer token     |
| `FileFormName`          | `image`                                                  | File form name   |
| `URL` (`{json:…}`)      | `{json:url}` → field name `url`                          | Response field   |
| `Origin`                | `https://img.example.com` (optional, otherwise derived automatically) | Origin header |

Procedure:

1. Download the ShareX configuration in Slink (profile → External Integrations).
2. Transfer each row of the table above into the corresponding app setting;
   for `Authorization`, the whole value can be pasted — the app strips the
   `Bearer ` prefix automatically and adds it back when sending; for `URL`,
   enter only the field name from `{json:…}`.
3. Save and upload a test image file.

The `ThumbnailURL` field of the ShareX configuration is not needed by the
app.

### Context-menu entries

The actions in the Files context menu are not fixed in code but generated
dynamically from the configuration. The admin form contains a table where
entries can be added and removed at any time:

| Column         | Meaning                                                                  |
|----------------|--------------------------------------------------------------------------|
| Name           | Displayed name of the context-menu action, e.g. "Title image"           |
| URL parameters | Query parameters appended to the share URL, e.g. `width=1200&format=jpeg` |
| Max. width (px)| Maximum image width for the upload; larger images are scaled down proportionally. `0` = original size |
| Zu JPG konvertieren | Converts the image to JPEG before the upload (file extension `.jpg`) |
| JPG-Qualität (%) | JPEG quality in percent for the conversion; `0` or empty = default 85 |

Example configuration:

| Name          | URL parameters            | Max. width (px) | Zu JPG konvertieren | JPG-Qualität (%) |
|---------------|---------------------------|-----------------|---------------------|------------------|
| Title image   | `width=1200&format=jpeg`  | 1200            | yes                 | 85               |
| Article image | `width=560&format=jpeg`   | 560             | yes                 | 80               |

Each entry creates its own action in the context menu. On click, the file
is uploaded and the parameters are appended to the returned URL — with `?` if
the URL does not yet have a query part, otherwise with `&`:

```
https://img.example.com/image-id.jpg?width=1200&format=jpeg
```

Notes:

- Width limiting and JPEG conversion are applied server-side **before**
  the upload, so they work independently of Slink's URL parameters.
  The JPEG quality is configurable per entry (0/empty = 85). The
  processing options are read from the server-side entry
  configuration via the entry name — they cannot be altered from the
  client.
- The original file in Nextcloud is never modified; the processed copy
  only exists in memory for the upload request.
- Failsafe: if PHP GD is unavailable or the image cannot be processed
  (unsupported format, broken image, memory limit), the untouched
  original is uploaded instead and the request never fails because of
  the processing.
- Entries stored by app versions before 0.3.0 keep working; they behave
  as if "Max. width" were `0`, "Zu JPG konvertieren" unchecked and
  "JPG-Qualität" `0`.
- If no entry is configured, the app shows a single default action
  "Upload to Slink" without parameters (and without processing).
- A leading `?` or `&` in the parameters is removed automatically.
- Allowed characters for the parameters are letters, digits, and
  `= & % . _ ~ : - , /`; other characters are rejected on save. The
  maximum width must be between 0 and 20000; the JPEG quality between 0
  (default) and 100.
- Unchanged re-uploads of an image are rejected by Slink as duplicates and
  handled transparently (see "What happens on click"). A resized or
  converted copy counts as a new image, so different processing options
  of one file can coexist on Slink.
- The entries are fetched from the server when the Files app loads
  (`GET /apps/slink_uploader/entries`); changes take effect after the next
  page reload. If fetching fails, the app registers the default action
  after a short delay so uploads remain possible (without processing).

## Installation

**Instances with file access:** Copy the `slink_uploader/` folder into the
`apps/` directory and enable the app under "Apps".

**Limited managed instances (e.g. Hetzner Storage Share):** Offerings like
Hetzner Storage Share (currently Nextcloud 33/34) are managed instances
without shell/SSH access; the `apps/` directory is not directly reachable.
Apps outside the integrated app store can only be installed there through
the web interface — using the Nextcloud app **AppDrop**, which allows
uploading an app ZIP:

1. Upload `slink_uploader.zip` (the ZIP contains the top-level folder
   `slink_uploader/`). If the structure check complains, zip the **contents**
   of the folder instead (i.e. `appinfo/` at the top level) and upload again.
2. Enable the app (AppDrop does this automatically, or under "Apps").
3. Set all connection values from the ShareX configuration in the
   administration settings (see "Configuration").
4. Click "Upload to Slink" in the Files context menu of an image file.

For an update, raise the `<version>` in `appinfo/info.xml`, rebuild the ZIP
and upload it again via AppDrop (or copy the folder over the old one).

## Cleanup

`occ slink_uploader:cleanup-comments [--dry-run]` deletes every comment the
app created on files (all comments whose message starts with `Slink`),
e.g. to reset a test installation. `--dry-run` only lists the matching
comments, with comment ID, file ID and message.

```bash
# Nextcloud AIO:
sudo docker exec --user www-data nextcloud-aio-nextcloud php occ slink_uploader:cleanup-comments --dry-run
sudo docker exec --user www-data nextcloud-aio-nextcloud php occ slink_uploader:cleanup-comments
```

## Technical notes

- **Build-free:** The frontend (`js/slink_uploader-main.js`) uses no bundled
  npm packages. Actions are registered, depending on the version, through
  the channel the respective Files app actually reads: NC 30–32 via the
  global store `OCA.Files.fileActions` (positional callbacks,
  @nextcloud/files v3), NC 33+ via `window._nc_files_scope.v4_0`
  (Map + registry event, @nextcloud/files v4). The script is loaded as an
  init script (`Util::addInitScript`) so the registration happens early
  enough in the bootstrap flow.
- **Image processing:** Width limiting and JPEG conversion use the PHP
  GD extension (`lib/Service/ImageService.php`). Processing runs in
  memory only; the processed copy is passed to the upload and then
  discarded. Without GD, or whenever processing fails, the original is
  uploaded (failsafe, logged in the Nextcloud log).
- **Comments:** Uses the Comments API (object type `files`); the marker
  prefix `Slink - ` enables the find-or-update behaviour, with one
  comment per context-menu entry.
- **Security:** The upload runs entirely server-side in the user's context
  (access rights are enforced via `IRootFolder::getUserFolder()`); the
  configuration is admin-only; the CSRF token is sent with all requests.
- **Translations:** The UI uses English source strings via Nextcloud's
  L10n (`$l->t()` in PHP, `t()` in JS). A German translation ships in
  `l10n/de.json`; further languages can be added the same way.

## Project structure

```
slink_uploader/
├── appinfo/
│   ├── info.xml                          # Metadata (NC 30–34), admin settings + occ command registration
│   └── routes.php                        # POST /upload, GET /entries, POST /config
├── lib/
│   ├── AppInfo/Application.php           # Loads js/slink_uploader-main.js as init script
│   ├── Command/CleanupComments.php       # occ slink_uploader:cleanup-comments [--dry-run]
│   ├── Controller/UploadController.php   # Endpoint: load file → Slink → comment
│   ├── Controller/ConfigController.php   # Admin-only: saves endpoint/token/response field/file form name/origin
│   ├── Service/SlinkService.php          # HTTP upload to the Slink API (multipart)
│   ├── Service/SlinkDuplicateException.php  # Duplicate-image rejection of the Slink API
│   ├── Service/MenuService.php           # Context-menu entries (name + URL parameters), validation
│   ├── Service/CommentService.php       # One updatable comment per context-menu entry
│   ├── Settings/Admin.php                # Admin panel in its own "Slink Uploader" section (/settings/admin/slink_uploader)
│   └── Settings/Section.php              # Own admin settings section (IIconSection)
├── img/
│   └── app.svg                           # App icon (used by the admin section)
├── templates/
│   └── admin.php                         # Configuration form (vanilla PHP template)
├── js/
│   ├── admin-settings.js                 # Admin form logic (fetch save, build-free; separate file due to CSP)
│   └── slink_uploader-main.js            # File action registration (build-free)
├── l10n/
│   └── de.json                           # German UI translation
└── README.md
```

## About

This app was created with AI assistance: it was designed and developed in
collaboration based on the idea and requirements of the author.
Licensed under the GNU AGPL (see `appinfo/info.xml`).
