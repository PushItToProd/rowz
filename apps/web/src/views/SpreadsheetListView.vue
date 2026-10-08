<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  nextTick,
  watch,
  type ComponentPublicInstance,
} from "vue";
import { useRouter } from "vue-router";
import {
  LIMITS,
  type DocumentSearchMatch,
  type DocumentSearchResponse,
} from "@spreadsheet-app/shared";
import ContextMenu from "../components/ContextMenu.vue";
import EditableName from "../components/EditableName.vue";
import ErrorWarning from "../components/ErrorWarning.vue";
import NoticeMessage from "../components/NoticeMessage.vue";
import { api, type FolderRecord, type ListedSpreadsheetItem } from "../api/client";
import { queuedListNotice, takeQueuedListNotice, type Notice } from "../notice";
import type { MenuItem } from "../components/menu";
import { APP_NAME } from "../appName";
import { loadGalleryExamples, uniqueDocumentName, type GalleryExample } from "../files/gallery";
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
const searchQuery = ref("");
const searchResults = ref<DocumentSearchResponse | null>(null);
const searchLoading = ref(false);
const searchError = ref<string | null>(null);
const notice = ref<Notice | null>(null);
function receiveQueuedNotice(): void {
  const queued = takeQueuedListNotice();
  if (queued) notice.value = queued;
}
receiveQueuedNotice();
watch(queuedListNotice, receiveQueuedNotice, { flush: "sync" });
const creatingFolder = ref(false);
const showingTemplates = ref(false);
const galleryOpen = ref(false);
const galleryLoading = ref(false);
const galleryLoadError = ref<string | null>(null);
const galleryImportError = ref<string | null>(null);
const galleryExamples = ref<GalleryExample[] | null>(null);
const importingExampleId = ref<string | null>(null);
const newFolderName = ref("");
const editingFolderId = ref<string | null>(null);
const editingFolderName = ref("");
const collapsed = ref(new Set<string>());
const createFolderInput = ref<HTMLInputElement>();
const galleryDialog = ref<HTMLElement>();
const galleryCloseButton = ref<HTMLButtonElement>();
const galleryOpener = ref<HTMLElement | null>(null);
const moveMenu = ref<{ document: ListedSpreadsheetItem; x: number; y: number } | null>(null);
const actionMenu = ref<{ document: ListedSpreadsheetItem; x: number; y: number } | null>(null);
const documentNameEditors = new Map<string, InstanceType<typeof EditableName>>();
const searchActive = computed(() => searchQuery.value.length > 0);
const localNameResults = computed<DocumentSearchResponse>(() => {
  const query = searchQuery.value.toLocaleLowerCase();
  if (query.length !== 1) return [];
  return (documents.value ?? []).flatMap((document) => {
    const offset = document.name.toLocaleLowerCase().indexOf(query);
    if (offset < 0) return [];
    const start = Math.max(0, offset - 40);
    const end = Math.min(document.name.length, offset + query.length + 40);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < document.name.length ? "…" : "";
    const snippet = `${prefix}${document.name.slice(start, end)}${suffix}`;
    return [
      {
        spreadsheetId: document.id,
        name: document.name,
        matches: [
          {
            kind: "name" as const,
            pageName: null,
            blockName: null,
            snippet,
            matchStart: prefix.length + offset - start,
            matchEnd: prefix.length + offset - start + query.length,
          },
        ],
      },
    ];
  });
});
const displayedSearchResults = computed(() =>
  searchQuery.value.length === 1 ? localNameResults.value : searchResults.value,
);

let searchTimeout: ReturnType<typeof setTimeout> | undefined;
let searchGeneration = 0;

async function loadSearch(query: string, generation: number): Promise<void> {
  try {
    const results = await api.searchDocuments(query);
    if (generation === searchGeneration) {
      searchResults.value = results;
      searchError.value = null;
    }
  } catch (cause) {
    if (generation === searchGeneration) {
      searchError.value = cause instanceof Error ? cause.message : "Search failed";
    }
  } finally {
    if (generation === searchGeneration) searchLoading.value = false;
  }
}

watch(searchQuery, (query) => {
  if (searchTimeout !== undefined) clearTimeout(searchTimeout);
  const generation = ++searchGeneration;
  searchError.value = null;
  if (query.length < 2) {
    searchResults.value = null;
    searchLoading.value = false;
    return;
  }
  searchResults.value = null;
  searchLoading.value = true;
  searchTimeout = setTimeout(() => void loadSearch(query, generation), 250);
});

function retrySearch(): void {
  const generation = ++searchGeneration;
  searchError.value = null;
  searchLoading.value = true;
  void loadSearch(searchQuery.value, generation);
}

function highlightedParts(match: DocumentSearchMatch): { text: string; highlighted: boolean }[] {
  return [
    { text: match.snippet.slice(0, match.matchStart), highlighted: false },
    {
      text: match.snippet.slice(match.matchStart, match.matchEnd),
      highlighted: true,
    },
    { text: match.snippet.slice(match.matchEnd), highlighted: false },
  ].filter(({ text }) => text.length > 0);
}

function searchMatchLabel(match: DocumentSearchMatch): string {
  if (match.kind === "name") return "Document name";
  const location = [match.pageName, match.blockName, match.address].filter(Boolean).join(" › ");
  return `${match.kind} · ${location}`;
}

async function run(
  action: () => Promise<void>,
  options: { preserveNotice?: boolean } = {},
): Promise<void> {
  try {
    await action();
    if (!options.preserveNotice && notice.value?.kind === "error") notice.value = null;
  } catch (cause) {
    if (!options.preserveNotice || !notice.value) {
      notice.value = {
        kind: "error",
        text: cause instanceof Error ? cause.message : "Something went wrong",
      };
    }
  }
}

async function refreshData(): Promise<void> {
  const listed = await api.listSpreadsheets();
  folders.value = listed.folders;
  documents.value = listed.documents;
}

const create = (): Promise<void> =>
  run(async () => {
    const created = await api.createSpreadsheet("Untitled document");
    await router.push({ name: "editor", params: { spreadsheetId: created.id } });
  });

const createFromTemplate = (template: DocumentTemplate): Promise<void> =>
  run(async () => {
    showingTemplates.value = false;
    if (documents.value === null) await refreshData();
    const document = {
      ...template.document,
      name: uniqueDocumentName(
        template.name,
        (documents.value ?? []).map((item) => item.name),
      ),
    };
    const created = await api.importSpreadsheet(document);
    await router.push({ name: "editor", params: { spreadsheetId: created.id } });
  });

async function loadGallery(): Promise<void> {
  if (galleryExamples.value !== null || galleryLoading.value) return;
  galleryLoading.value = true;
  galleryLoadError.value = null;
  try {
    galleryExamples.value = await loadGalleryExamples();
  } catch (cause) {
    galleryLoadError.value = cause instanceof Error ? cause.message : "Could not load examples";
  } finally {
    galleryLoading.value = false;
  }
}

async function openGallery(): Promise<void> {
  galleryOpener.value = globalThis.document.activeElement as HTMLElement | null;
  galleryOpen.value = true;
  galleryImportError.value = null;
  await nextTick();
  galleryCloseButton.value?.focus();
  await loadGallery();
}

function closeGallery(restoreFocus = true): void {
  galleryOpen.value = false;
  if (restoreFocus) void nextTick(() => galleryOpener.value?.focus());
}

function handleGalleryKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    closeGallery();
    return;
  }
  if (event.key !== "Tab") return;

  const dialog = galleryDialog.value;
  if (!dialog) return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const active = globalThis.document.activeElement;
  if (!(active instanceof HTMLElement) || !focusable.includes(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

async function useExample(example: GalleryExample): Promise<void> {
  if (importingExampleId.value !== null) return;
  importingExampleId.value = example.id;
  galleryImportError.value = null;
  galleryCloseButton.value?.focus();
  try {
    if (documents.value === null) await refreshData();
    const document = {
      ...example.document,
      name: uniqueDocumentName(
        example.title,
        (documents.value ?? []).map((item) => item.name),
      ),
    };
    const created = await api.importSpreadsheet(document);
    closeGallery(false);
    await router.push({ name: "editor", params: { spreadsheetId: created.id } });
  } catch (cause) {
    galleryImportError.value = cause instanceof Error ? cause.message : "Could not create example";
  } finally {
    importingExampleId.value = null;
  }
}

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

function captureDocumentNameEditor(
  id: string,
  editor: Element | ComponentPublicInstance | null,
): void {
  if (editor) documentNameEditors.set(id, editor as InstanceType<typeof EditableName>);
  else documentNameEditors.delete(id);
}

function beginRenameDocument(document: ListedSpreadsheetItem): void {
  if (document.role !== "owner") return;
  void documentNameEditors.get(document.id)?.start();
}

const renameDocument = (document: ListedSpreadsheetItem, name: string): Promise<void> =>
  run(async () => {
    if (document.role !== "owner") return;
    if (name !== document.name) await api.renameSpreadsheet(document.id, name);
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
      ? [
          {
            label: "Rename",
            run: () => {
              beginRenameDocument(target);
            },
          },
        ]
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

onMounted(() => void run(refreshData, { preserveNotice: true }));
onBeforeUnmount(() => {
  if (searchTimeout !== undefined) clearTimeout(searchTimeout);
  searchGeneration++;
});
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

    <div class="list__search">
      <label class="list__search-field">
        <span>Search documents</span>
        <input
          v-model="searchQuery"
          type="search"
          aria-label="Search documents"
          placeholder="Names and content"
          maxlength="200"
          autocomplete="off"
        />
      </label>
      <button v-if="searchActive" type="button" aria-label="Clear search" @click="searchQuery = ''">
        Clear
      </button>
    </div>

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
          v-show="showingTemplates"
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
      <button type="button" @click="openGallery">Browse samples and templates</button>
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

    <div v-if="searchActive" class="list__search-content">
      <p v-if="searchError" class="list__search-error" role="alert">
        Search failed: {{ searchError }}
        <button type="button" @click="retrySearch">Try again</button>
      </p>
      <p
        v-else-if="searchLoading || (searchQuery.length === 1 && documents === null)"
        class="list__search-status"
        role="status"
      >
        Searching…
      </p>
      <p v-else-if="displayedSearchResults?.length === 0" class="list__search-empty">
        No documents match
      </p>
      <ul v-else-if="displayedSearchResults" class="list__search-results">
        <li v-for="result in displayedSearchResults" :key="result.spreadsheetId">
          <article class="list__search-result">
            <RouterLink :to="{ name: 'editor', params: { spreadsheetId: result.spreadsheetId } }">
              {{ result.name }}
            </RouterLink>
            <ul>
              <li v-for="(match, index) in result.matches" :key="`${match.kind}-${index}`">
                <span class="list__search-location">{{ searchMatchLabel(match) }}</span>
                <span class="list__search-snippet">
                  <template v-for="(part, partIndex) in highlightedParts(match)" :key="partIndex">
                    <mark v-if="part.highlighted">{{ part.text }}</mark>
                    <span v-else>{{ part.text }}</span>
                  </template>
                </span>
              </li>
            </ul>
          </article>
        </li>
      </ul>
    </div>
    <p v-else-if="documents === null && !notice">Loading…</p>
    <div v-else-if="documents?.length === 0 && folders.length === 0" class="list__empty">
      <p>No documents yet. Create one to get started.</p>
      <button type="button" @click="openGallery">Browse samples and templates</button>
    </div>
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
            <ErrorWarning v-if="document.hasErrors" :label="`${document.name} contains errors`" />
            <EditableName
              v-if="document.role === 'owner'"
              :ref="(editor) => captureDocumentNameEditor(document.id, editor)"
              :value="document.name"
              :label="`Document name for ${document.name}`"
              @rename="renameDocument(document, $event)"
            />
            <RouterLink v-else :to="{ name: 'editor', params: { spreadsheetId: document.id } }">
              {{ document.name }}
            </RouterLink>
            <RouterLink
              v-if="document.role === 'owner'"
              class="list__document-open"
              :aria-label="`Open ${document.name}`"
              :to="{ name: 'editor', params: { spreadsheetId: document.id } }"
            >
              Open
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

    <div v-if="galleryOpen" class="list__gallery-backdrop" @click.self="closeGallery()">
      <section
        ref="galleryDialog"
        class="list__gallery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="samples-gallery-title"
        tabindex="-1"
        @keydown="handleGalleryKeydown"
      >
        <header class="list__gallery-header">
          <div>
            <h2 id="samples-gallery-title">Samples and templates</h2>
            <p>Start with an editable copy in your documents.</p>
          </div>
          <button
            ref="galleryCloseButton"
            type="button"
            aria-label="Close samples and templates"
            @click="closeGallery()"
          >
            Close
          </button>
        </header>

        <p v-if="galleryLoading" class="list__gallery-status" role="status">Loading examples…</p>
        <div v-else-if="galleryLoadError" class="list__gallery-status" role="alert">
          <p>Examples could not be loaded: {{ galleryLoadError }}</p>
          <button type="button" @click="loadGallery">Try again</button>
        </div>
        <div v-else-if="galleryExamples" class="list__gallery-grid">
          <article v-for="example in galleryExamples" :key="example.id" class="list__gallery-card">
            <div class="list__gallery-card-heading">
              <span class="list__gallery-category">{{ example.category }}</span>
              <h3>{{ example.title }}</h3>
            </div>
            <p class="list__gallery-description" :title="example.description">
              {{ example.description }}
            </p>
            <ul class="list__gallery-features" :aria-label="`Features in ${example.title}`">
              <li v-for="feature in example.features" :key="feature" class="badge">
                {{ feature }}
              </li>
            </ul>
            <button
              type="button"
              class="primary"
              :aria-label="`Use ${example.title}`"
              :disabled="importingExampleId !== null"
              @click="useExample(example)"
            >
              {{ importingExampleId === example.id ? "Creating…" : "Use this" }}
            </button>
          </article>
          <p v-if="galleryImportError" class="list__gallery-import-error" role="alert">
            {{ galleryImportError }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
