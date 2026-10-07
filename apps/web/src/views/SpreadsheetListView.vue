<script setup lang="ts">
import { computed, onMounted, ref, nextTick } from "vue";
import { useRouter } from "vue-router";
import { LIMITS } from "@spreadsheet-app/shared";
import ContextMenu from "../components/ContextMenu.vue";
import ErrorWarning from "../components/ErrorWarning.vue";
import NoticeMessage from "../components/NoticeMessage.vue";
import { api, type FolderRecord, type ListedSpreadsheetItem } from "../api/client";
import type { Notice } from "../notice";
import type { MenuItem } from "../components/menu";
import { APP_NAME } from "../appName";
import { readSpreadsheetFile } from "../files/spreadsheetFile";
import { DOCUMENT_TEMPLATES, type DocumentTemplate } from "../files/templates";
import { usePageTitle } from "../pageTitle";
import { useSessionStore } from "../stores/session";
import { useDialog } from "../useDialog";

const session = useSessionStore();
const router = useRouter();
const dialog = useDialog();
usePageTitle("Documents");

const folders = ref<FolderRecord[]>([]);
const documents = ref<ListedSpreadsheetItem[] | null>(null);
const notice = ref<Notice | null>(null);
const creatingFolder = ref(false);
const showingTemplates = ref(false);
const newFolderName = ref("");
const editingFolderId = ref<string | null>(null);
const editingFolderName = ref("");
const editingDocumentId = ref<string | null>(null);
const editingDocumentName = ref("");
const collapsed = ref(new Set<string>());
const createFolderInput = ref<HTMLInputElement>();
const moveMenu = ref<{ document: ListedSpreadsheetItem; x: number; y: number } | null>(null);
const actionMenu = ref<{ document: ListedSpreadsheetItem; x: number; y: number } | null>(null);

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
    if (notice.value?.kind === "error") notice.value = null;
  } catch (cause) {
    notice.value = {
      kind: "error",
      text: cause instanceof Error ? cause.message : "Something went wrong",
    };
  }
}

async function refreshData(): Promise<void> {
  const listed = await api.listSpreadsheets();
  folders.value = listed.folders;
  documents.value = listed.documents;
}

const refresh = (): Promise<void> => run(refreshData);

const create = (): Promise<void> =>
  run(async () => {
    const created = await api.createSpreadsheet("Untitled document");
    await router.push({ name: "editor", params: { spreadsheetId: created.id } });
  });

const createFromTemplate = (template: DocumentTemplate): Promise<void> =>
  run(async () => {
    showingTemplates.value = false;
    const created = await api.importSpreadsheet(template.document);
    await router.push({ name: "editor", params: { spreadsheetId: created.id } });
  });

/** Creates a document from a chosen file that an export wrote, and opens it. */
const importFile = (event: Event): Promise<void> =>
  run(async () => {
    const input = event.target as HTMLInputElement;
    const [file] = input.files ?? [];
    // Cleared so that choosing the same file again is a change the input reports.
    input.value = "";
    if (!file) return;
    const created = await api.importSpreadsheet(readSpreadsheetFile(await file.text()));
    await router.push({ name: "editor", params: { spreadsheetId: created.id } });
  });

const remove = (document: ListedSpreadsheetItem): Promise<void> =>
  run(async () => {
    if (document.role !== "owner") return;
    if (
      !(await dialog.confirm({
        title: "Delete document",
        message: `Delete ${document.name}? This cannot be undone.`,
        confirmLabel: "Delete document",
        danger: true,
      }))
    )
      return;
    await api.deleteSpreadsheet(document.id);
    await refreshData();
  });

async function beginRenameDocument(document: ListedSpreadsheetItem): Promise<void> {
  if (document.role !== "owner") return;
  editingDocumentId.value = document.id;
  editingDocumentName.value = document.name;
  await nextTick();
  const input = globalThis.document.getElementById(`document-name-${document.id}`);
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.select();
  }
}

function cancelRenameDocument(): void {
  editingDocumentId.value = null;
  editingDocumentName.value = "";
}

const submitRenameDocument = (document: ListedSpreadsheetItem): Promise<void> =>
  run(async () => {
    if (document.role !== "owner") return;
    const name = editingDocumentName.value.trim();
    if (!name) return;
    if (name !== document.name) await api.renameSpreadsheet(document.id, name);
    cancelRenameDocument();
    await refreshData();
  });

const duplicate = (document: ListedSpreadsheetItem): Promise<void> =>
  run(async () => {
    const copy = await api.copySpreadsheet(document.id);
    await refreshData();
    notice.value = { kind: "success", text: `Created "${copy.name}"` };
  });

async function beginCreateFolder(): Promise<void> {
  cancelRenameFolder();
  creatingFolder.value = true;
  await nextTick();
  createFolderInput.value?.focus();
}

function cancelCreateFolder(): void {
  creatingFolder.value = false;
  newFolderName.value = "";
}

const submitCreateFolder = (): Promise<void> =>
  run(async () => {
    const name = newFolderName.value.trim();
    if (!name) return;
    await api.createFolder(name);
    cancelCreateFolder();
    await refreshData();
  });

async function beginRenameFolder(folder: FolderRecord): Promise<void> {
  cancelCreateFolder();
  editingFolderId.value = folder.id;
  editingFolderName.value = folder.name;
  await nextTick();
  const input = document.getElementById(`folder-name-${folder.id}`);
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.select();
  }
}

function cancelRenameFolder(): void {
  editingFolderId.value = null;
  editingFolderName.value = "";
}

const submitRenameFolder = (folder: FolderRecord): Promise<void> =>
  run(async () => {
    const name = editingFolderName.value.trim();
    if (!name) return;
    if (name !== folder.name) await api.renameFolder(folder.id, name);
    cancelRenameFolder();
    await refreshData();
  });

const removeFolder = (folder: FolderRecord): Promise<void> =>
  run(async () => {
    await api.deleteFolder(folder.id);
    await refreshData();
  });

const moveDocument = (document: ListedSpreadsheetItem, folderId: string | null): Promise<void> =>
  run(async () => {
    await api.moveDocument(document.id, folderId);
    await refreshData();
  });

const ROOT_GROUP_ID = "unfiled";
const groups = computed(() => {
  const allDocuments = documents.value ?? [];
  return [
    ...folders.value.map((folder) => ({
      id: folder.id,
      name: folder.name,
      folder,
      documents: allDocuments.filter((document) => document.folderId === folder.id),
    })),
    {
      id: ROOT_GROUP_ID,
      name: "Unfiled",
      folder: null,
      documents: allDocuments.filter((document) => document.folderId === null),
    },
  ];
});

function toggleGroup(id: string): void {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}

function groupId(id: string): string {
  return `documents-${id}`;
}

function openMoveMenu(event: MouseEvent, document: ListedSpreadsheetItem): void {
  moveMenu.value = { document, x: event.clientX, y: event.clientY };
}

function openActionMenu(event: MouseEvent, document: ListedSpreadsheetItem): void {
  actionMenu.value = { document, x: event.clientX, y: event.clientY };
}

const moveItems = computed<MenuItem[]>(() => {
  const target = moveMenu.value?.document;
  if (!target) return [];
  return [
    {
      label: "Move to Unfiled",
      disabled: target.folderId === null,
      run: () => void moveDocument(target, null),
    },
    ...folders.value.map((folder) => ({
      label: `Move to ${folder.name}`,
      disabled: target.folderId === folder.id,
      run: () => void moveDocument(target, folder.id),
    })),
  ];
});

const actionItems = computed<MenuItem[]>(() => {
  const target = actionMenu.value?.document;
  if (!target) return [];
  const items: MenuItem[] = [
    ...(target.role === "owner"
      ? [{ label: "Rename", run: () => void beginRenameDocument(target) }]
      : []),
    { label: "Duplicate", run: () => void duplicate(target) },
    ...(target.role === "owner"
      ? [{ label: "Delete", danger: true, separated: true, run: () => void remove(target) }]
      : []),
  ];
  return items;
});

async function signOut(): Promise<void> {
  await session.signOut();
  await router.push({ name: "login" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

onMounted(refresh);
</script>

<template>
  <div class="list">
    <header class="list__header">
      <span class="brand">{{ APP_NAME }}</span>
      <h1>Documents</h1>
      <RouterLink :to="{ name: 'help' }">Help</RouterLink>
      <span class="list__user">{{ session.user?.email }}</span>
      <button type="button" @click="signOut">Sign out</button>
    </header>

    <NoticeMessage v-if="notice" :notice="notice" @dismiss="notice = null" />

    <div class="list__actions">
      <button type="button" class="primary" @click="create">New document</button>
      <div class="list__template-picker">
        <button
          type="button"
          :aria-expanded="showingTemplates"
          aria-controls="document-templates"
          @click="showingTemplates = !showingTemplates"
        >
          New from template
        </button>
        <div
          v-if="showingTemplates"
          id="document-templates"
          class="list__templates"
          role="group"
          aria-label="Document templates"
        >
          <button
            v-for="template in DOCUMENT_TEMPLATES"
            :key="template.name"
            type="button"
            class="list__template"
            :aria-label="`Create ${template.name} from template`"
            @click="createFromTemplate(template)"
          >
            <span class="list__template-name">{{ template.name }}</span>
            <span class="list__template-description">{{ template.description }}</span>
          </button>
        </div>
      </div>
      <button type="button" @click="beginCreateFolder">New folder</button>
      <label class="file-button">
        Import
        <input type="file" accept=".json,application/json" @change="importFile" />
      </label>
    </div>

    <form
      v-if="creatingFolder"
      class="list__folder-form"
      aria-label="Create folder"
      @submit.prevent="submitCreateFolder"
    >
      <label>
        Folder name
        <input
          ref="createFolderInput"
          v-model="newFolderName"
          aria-label="New folder name"
          :maxlength="LIMITS.nameLength"
          required
        />
      </label>
      <button type="submit" class="primary">Create folder</button>
      <button type="button" @click="cancelCreateFolder">Cancel</button>
    </form>

    <p v-if="documents === null && !notice">Loading…</p>
    <p v-else-if="documents?.length === 0 && folders.length === 0" class="list__empty">
      No documents yet. Create one to get started.
    </p>
    <div v-else-if="documents !== null" class="list__groups">
      <section v-for="group in groups" :key="group.id" class="list__group">
        <header class="list__group-header">
          <button
            type="button"
            class="list__group-toggle"
            :aria-expanded="!collapsed.has(group.id)"
            :aria-controls="groupId(group.id)"
            @click="toggleGroup(group.id)"
          >
            <span aria-hidden="true">{{ collapsed.has(group.id) ? "▸" : "▾" }}</span>
            <span>{{ group.name }}</span>
            <span class="badge">{{ group.documents.length }}</span>
          </button>
          <div v-if="group.folder" class="list__group-actions">
            <button
              type="button"
              :aria-label="`Rename folder ${group.folder.name}`"
              @click="beginRenameFolder(group.folder)"
            >
              Rename
            </button>
            <button
              type="button"
              class="danger"
              :aria-label="`Delete folder ${group.folder.name}`"
              title="Moves its documents to Unfiled"
              @click="removeFolder(group.folder)"
            >
              Delete
            </button>
          </div>
        </header>

        <form
          v-if="group.folder && editingFolderId === group.folder.id"
          class="list__folder-form"
          :aria-label="`Rename folder ${group.folder.name}`"
          @submit.prevent="submitRenameFolder(group.folder)"
        >
          <label>
            Folder name
            <input
              :id="`folder-name-${group.folder.id}`"
              v-model="editingFolderName"
              :aria-label="`Folder name for ${group.folder.name}`"
              :maxlength="LIMITS.nameLength"
              required
              @keydown.esc.stop.prevent="cancelRenameFolder"
            />
          </label>
          <button type="submit" class="primary">Save folder name</button>
          <button type="button" @click="cancelRenameFolder">Cancel</button>
        </form>

        <ul v-show="!collapsed.has(group.id)" :id="groupId(group.id)" class="list__items">
          <li v-for="document in group.documents" :key="document.id">
            <form
              v-if="editingDocumentId === document.id"
              class="list__document-rename"
              :aria-label="`Rename document ${document.name}`"
              @submit.prevent="submitRenameDocument(document)"
            >
              <input
                :id="`document-name-${document.id}`"
                v-model="editingDocumentName"
                :aria-label="`Document name for ${document.name}`"
                :maxlength="LIMITS.nameLength"
                required
                @keydown.esc.stop.prevent="cancelRenameDocument"
              />
              <button type="submit" class="primary">Save</button>
              <button type="button" @click="cancelRenameDocument">Cancel</button>
            </form>
            <RouterLink v-else :to="{ name: 'editor', params: { spreadsheetId: document.id } }">
              <ErrorWarning v-if="document.hasErrors" :label="`${document.name} contains errors`" />
              {{ document.name }}
            </RouterLink>
            <span v-if="document.role !== 'owner'" class="badge">
              Shared with you · {{ document.role === "editor" ? "can edit" : "can view" }}
            </span>
            <time :datetime="document.updatedAt">{{ formatDate(document.updatedAt) }}</time>
            <button
              type="button"
              aria-haspopup="menu"
              :aria-expanded="actionMenu?.document.id === document.id"
              :aria-label="`Actions for ${document.name}`"
              @click="openActionMenu($event, document)"
            >
              ⋯
            </button>
            <button
              v-if="folders.length > 0"
              type="button"
              :aria-label="`Move ${document.name} to a folder`"
              @click="openMoveMenu($event, document)"
            >
              Move
            </button>
          </li>
          <li v-if="group.documents.length === 0" class="list__group-empty">
            {{ group.folder ? "This folder is empty." : "No unfiled documents." }}
          </li>
        </ul>
      </section>
    </div>

    <ContextMenu
      v-if="moveMenu"
      :x="moveMenu.x"
      :y="moveMenu.y"
      :label="`Move ${moveMenu.document.name}`"
      :items="moveItems"
      @close="moveMenu = null"
    />
    <ContextMenu
      v-if="actionMenu"
      :x="actionMenu.x"
      :y="actionMenu.y"
      :label="`Actions for ${actionMenu.document.name}`"
      :items="actionItems"
      @close="actionMenu = null"
    />
  </div>
</template>
