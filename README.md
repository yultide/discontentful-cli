# Contentful Tools CLI

A collection of contentful tools and utlitiy functions to easily import and export content from an excel spreadsheet.

## Commands

### `ct init` - initialize contentful credentials

Creates a config file in your home directory called `.dc.config.json`.

Example interaction

```
You can get the management token from here: https://app.contentful.com/account/profile/cma_tokens
Click on Generate personal token.  Remember to save your token.  You will not see it again.
✔ Contentful Management Token (CFPA*****1234)
Hi John, let's get you setup.
✔ Select space to use test
✔ Select environment to use master
```

### `ct env` - quickly switch environments

```
ct env dev
ℹ changed environment master ->  dev
```

### `ct help` - print help message

Get detailed help messages. Detailed help documentation can be printed with `ct help [command]`

### `ct import <file>` - imports xlsx file into contentful

Imports the first sheet in excel into contentful. The first sheet must be the active saved sheet.

Example table

| sysid                 | model    | field        | en-US                        |
| --------------------- | -------- | ------------ | ---------------------------- |
| 7UyvK6JLO9TgOHAAwTNpX | blogPost | internalName | Blog Post #1                 |
|                       |          | title        | My first blog post           |
|                       |          | slug         | my-first-blog-post           |
|                       |          | tags         | array:new,featured           |
|                       |          | content      | markdownfile:blog-post-1.md  |
|                       |          | image        | asset:1XQrEdm2FAyHnaxmsNMG4N |

`sysid, model, field, en-US` are the minimum required fields.

To create new entries, you can set `new-XXXX` as the `sysid`. Linked references can also use the `new-XXX` id and the xlsx will be updated when the entries are created.

#### Values prefixes

There are special prefixes to process the cell value into a proper contentful structure (e.g. link references, assets, rich text, etc...).

Supported value prefixes:

- `links:` - entry links with comma separated values (e.g. links:66iJXokY3NxptpRyZaPA8K,571hHKmL6ypMPQHptUF8KV)
- `addlinks:` - appends entry links with comma separated values (e.g. links:66iJXokY3NxptpRyZaPA8K,571hHKmL6ypMPQHptUF8KV)
- `sheetlinks:` - entry links defined by another sheet (e.g. sheetlinks:new-sheet-name)
- `link:` - a single entry link (e.g. link:66iJXokY3NxptpRyZaPA8K)
- `assets:` - asset links to comma separated assets (e.g. assets:3VtLb74F43DLfYSDCrOEeR,5AyRGYLK1Vo6CyRNCEfKMv)
- `asset:` - a single asset link (e.g. asset:3VtLb74F43DLfYSDCrOEeR)
- `assetfile:` - an asset from a local file and link to entry (e.g. assetfile:image.png)
- `asseturl:` - an asset from a url and link to entry (e.g. asseturl:https://www.google.com/favicon.ico)
- `clear:` - clear the current field
- `compressasset:` - compress the specified asset by converting to jpg
- `image:` - alias for assetfile: and asseturl:
- `tags:` - metadata tags for the entry (field must be metadata)
- `array:` - comma separated string (e.g array:foo,bar,baz -> ["foo","bar","baz"])
- `bool:` - coerces value to be a boolean
- `number:` - coerces value to be a number (integer or float)
- `string:` - coerces value to be a string
- `json:` - parses the string into a json structure
- `jsonfile:` - parses the json structure from a file
- `markdown:` - parses markdown text into Contentful Rich Text
- `markdownfile:` - parses markdown file into Contentful Rich Text
- `docx:` - parses Word .docx file into Contentful Rich Text
- `docx2txt:` - parses Word .docx file into text (not markdown)
- `docx2md:` - parses Word .docx file into markdown text
- `html:` - parses HTML text into Contentful Rich Text
- `htmlfile:` - parses HTML file into Contentful Rich Text
- `date:` - coerces value to be a date (value must be ISO-8601 format)
- `upload:` - upload an asset to file field (`model` must be `asset` and `field` must be `file`)

Support for `.docx` and `.md` requires installation of [pandoc](https://pandoc.org/).

#### Adding assets/media

| sysid     | model | field       | en-US            |
| --------- | ----- | ----------- | ---------------- |
| new-asset | asset | title       | cat.jpg          |
|           |       | description | picture of a cat |
|           |       | file        | upload:cat.jpg   |

#### Adding tags

| sysid                 | model    | field    | en-US                |
| --------------------- | -------- | -------- | -------------------- |
| 7UyvK6JLO9TgOHAAwTNpX | blogPost | metadata | tags:featured,sticky |

### `ct export <entry-ids> [file]` - exports entries into an xlsx file

Create an xlsx file that contains a comma separated entry list. If you put a `-r, --recursive`, it will recursively find all the entries and include them in the export.
Adding `-t` will create a template you can use to create a new tree structure using the `new-XXX` prefix.

### `ct diff <lower-env> <higher-env>` - creates a diff report of two contentful environments

Creates a diff report between two environments. The command can also generate a migration (`-m, --create-migration`) script using [contentful-migration](https://github.com/contentful/contentful-migration).

Example

```
✔ Contentful env diff dev -> master
✔ Fetching content types for dev
✔ Fetching editor interfaces in environment dev
✔ Fetching content types for master
✔ Fetching editor interfaces in environment master
╔═══════════╤══════════════╤════════════╤══════════════════════╗
║ Operation │ Content Type │ Field Name │ Details              ║
╟───────────┼──────────────┼────────────┼──────────────────────╢
║ + model   │ blogPost     │            │ internalName:Symbol  ║
║           │              │            │ title:Symbol         ║
║           │              │            │ slug:Symbol          ║
║           │              │            │ .....                ║
╚═══════════╧══════════════╧════════════╧══════════════════════╝
```
