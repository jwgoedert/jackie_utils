# 🗃️ Strapi Database Schema Reference

> **Strapi Version**: v5.7.0  
> **Node Version**: v23.3.0  
> **DB**: SQLite (default)

---

## 📌 Key Tables

### ✅ **Core Media Tables**

- **`files`**
  - Stores metadata for all uploaded media files.
  - **Columns**: `id`, `document_id`, `name`, `alternative_text`, `caption`, `width`, `height`, `formats`, `hash`, `ext`, `mime`, `size`, `url`, `preview_url`, `provider`, `provider_metadata`, `folder_path`, `created_at`, `updated_at`, `published_at`, `created_by_id`, `updated_by_id`, `locale`.

- **`upload_folders`**
  - Stores folder structure for Media Library.
  - **Columns**: `id`, `document_id`, `name`, `path_id`, `path`, `created_at`, `updated_at`, `published_at`, `created_by_id`, `updated_by_id`, `locale`.

- **`files_folder_lnk`**
  - Links files to folders.
  - **Columns**: `id`, `file_id`, `folder_id`, `file_ord`.

- **`upload_folders_parent_lnk`**
  - Defines hierarchical relationships between folders.
  - **Columns**: `id`, `folder_id`, `inv_folder_id`, `folder_ord`.

### ✅ **Content Tables**

- **`projects`**
  - Main content entries.
  - **Columns**: `id`, `document_id`, `name`, `date`, `parent_vine`, `hyperlinks`, `locations`, `venue_institute`, `description`, `collaborators`, `created_at`, `updated_at`, `published_at`, `created_by_id`, `updated_by_id`, `locale`.

- **`tags`**
  - Tag entries.
  - **Columns**: `id`, `document_id`, `name`, `created_at`, `updated_at`, `published_at`, `created_by_id`, `updated_by_id`, `locale`.

- **`project_types`**
  - Types of projects.
  - **Columns**: `id`, `document_id`, `type`, `created_at`, `updated_at`, `published_at`, `created_by_id`, `updated_by_id`, `locale`.

- **`projects_tags_lnk`**: Links `projects` to `tags`.
  - **Columns**: `id`, `project_id`, `tag_id`, `tag_ord`.

- **`projects_type_lnk`**: Links `projects` to `project_types`.
  - **Columns**: `id`, `project_id`, `project_type_id`, `project_type_ord`.

---

## 🔑 **User & Permission Tables**

- **`admin_users`**
  - Admin accounts for Strapi.
  - Columns: `id`, `document_id`, `firstname`, `lastname`, `username`, `email`, `password`, `reset_password_token`, `registration_token`, `is_active`, `blocked`, `prefered_language`, `created_at`, `updated_at`, `published_at`, `created_by_id`, `updated_by_id`, `locale`.

- **`admin_roles`**
  - Admin role definitions.
  - Columns: `id`, `document_id`, `name`, `code`, `description`, `created_at`, `updated_at`, `published_at`, `created_by_id`, `updated_by_id`, `locale`.

- **`admin_permissions`**
  - Permissions associated with admin roles.
  - Columns: `id`, `document_id`, `action`, `action_parameters`, `subject`, `properties`, `conditions`, `created_at`, `updated_at`, `published_at`, `created_by_id`, `updated_by_id`, `locale`.

- Relations: `admin_users_roles_lnk`, `admin_permissions_role_lnk`.

- **`up_users`**, **`up_roles`**, **`up_permissions`**
  - For regular authenticated users (non-admins).

- Relations: `up_permissions_role_lnk`, `up_users_role_lnk`.

---

## 📡 **API & Token Management**

- **`strapi_api_tokens`**
  - API tokens generated in Strapi.
  - Columns: `id`, `document_id`, `name`, `description`, `type`, `access_key`, `last_used_at`, `expires_at`, `lifespan`, `created_at`, `updated_at`, `published_at`, `created_by_id`, `updated_by_id`, `locale`.

- Relations: `strapi_api_token_permissions_token_lnk`.

---

## 🎯 **Typical Queries / Operations**

**Query project data:**

```sql
SELECT * FROM projects WHERE name LIKE '%<project_name>%';
```

**Find associated tags for a project:**

```sql
SELECT tags.name FROM tags
JOIN projects_tags_lnk ON tags.id = projects_tags_lnk.tag_id
JOIN projects ON projects.id = projects_tags_lnk.project_id
WHERE projects.name = '<project_name>';
```

**List files in a specific folder:**

```sql
SELECT files.* FROM files
JOIN files_folder_lnk ON files.id = files_folder_lnk.file_id
JOIN upload_folders ON files_folder_lnk.folder_id = upload_folders.id
WHERE upload_folders.name = '<folder_name>';
```

---

## 🗂️ **Folder Structure (`upload_folders`)**

- Folders use a hierarchical structure (`path_id`, `path`).
- `document_id` is a UUID.

---

## ✅ **Best Practices for Reference**

- Save this file as `strapi_db_schema.md` in your project root or a dedicated documentation directory.
- Cursor and similar assistants automatically reference markdown files in your workspace, enhancing context awareness and improving suggestions.
