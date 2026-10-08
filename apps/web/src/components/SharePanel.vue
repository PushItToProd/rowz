<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { api, type MemberRecord } from "../api/client";
import { useDialog } from "../useDialog";

const props = defineProps<{
  spreadsheetId: string;
  /** Whether the viewer owns the spreadsheet, and so may share it. */
  owner: boolean;
  /** The viewer's own account, which may leave a spreadsheet shared with it. */
  userId: string | undefined;
}>();
const emit = defineEmits<{
  close: [];
  /** The viewer gave up their own access. */
  left: [];
}>();

type ShareRole = "editor" | "viewer";

const members = ref<MemberRecord[] | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const email = ref("");
const emailInput = ref<HTMLInputElement>();
const role = ref<ShareRole>("editor");
const panel = ref<HTMLElement>();
const dialog = useDialog();

const ROLE_LABELS = { owner: "Owner", editor: "Can edit", viewer: "Can view" } as const;

async function run(action: () => Promise<void>): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Something went wrong";
  } finally {
    busy.value = false;
  }
}

const refresh = (): Promise<void> =>
  run(async () => {
    members.value = await api.listMembers(props.spreadsheetId);
  });

function share(): Promise<void> {
  error.value = null;
  const address = email.value.trim();
  if (!address) {
    error.value = "Enter an email address.";
    return Promise.resolve();
  }
  if (emailInput.value) emailInput.value.value = address;
  email.value = address;
  if (emailInput.value?.validity.typeMismatch) {
    error.value = "Enter a valid email address.";
    return Promise.resolve();
  }
  return run(async () => {
    members.value = await api.share(props.spreadsheetId, address, role.value);
    email.value = "";
  });
}

function changeRole(member: MemberRecord, event: Event): Promise<void> {
  const chosen = (event.target as HTMLSelectElement).value as ShareRole;
  return run(async () => {
    members.value = await api.share(props.spreadsheetId, member.email, chosen);
  });
}

async function remove(member: MemberRecord): Promise<void> {
  const own = member.userId === props.userId;
  const asked = own
    ? "Leave this document? You will need to be given it again to open it."
    : `Stop sharing with ${member.name}?`;
  if (
    !(await dialog.confirm({
      title: own ? "Leave document" : "Stop sharing",
      message: asked,
      confirmLabel: own ? "Leave" : "Stop sharing",
      danger: true,
    }))
  )
    return;
  await run(async () => {
    await api.unshare(props.spreadsheetId, member.userId);
    if (own) emit("left");
    else members.value = await api.listMembers(props.spreadsheetId);
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  panel.value?.focus();
  void refresh();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <aside ref="panel" class="side-panel share" role="dialog" aria-label="Share" tabindex="-1">
    <header class="side-panel__header">
      <h2>Share</h2>
      <button type="button" aria-label="Close sharing" @click="emit('close')">×</button>
    </header>

    <form v-if="owner" class="share__form" novalidate @submit.prevent="share">
      <input
        ref="emailInput"
        v-model="email"
        type="email"
        required
        aria-label="Email of the person to share with"
        placeholder="name@example.com"
      />
      <select v-model="role" aria-label="What they can do">
        <option value="editor">Can edit</option>
        <option value="viewer">Can view</option>
      </select>
      <button type="submit" class="primary" :disabled="busy">Share</button>
    </form>
    <p v-else class="history__about">Only the owner can share this document.</p>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-if="members === null && !error">Loading…</p>
    <ul v-else class="share__list">
      <li v-for="member in members" :key="member.userId" :data-member="member.email">
        <span class="share__who">
          <span>{{ member.name }}</span>
          <span class="share__email">{{ member.email }}</span>
        </span>
        <select
          v-if="owner && member.shared"
          :aria-label="`What ${member.name} can do`"
          :value="member.role"
          :disabled="busy"
          @change="changeRole(member, $event)"
        >
          <option value="editor">Can edit</option>
          <option value="viewer">Can view</option>
        </select>
        <span v-else class="share__role">{{ ROLE_LABELS[member.role] }}</span>
        <button
          v-if="member.shared && (owner || member.userId === userId)"
          type="button"
          class="danger"
          :disabled="busy"
          :aria-label="
            member.userId === userId ? 'Leave this document' : `Stop sharing with ${member.name}`
          "
          @click="remove(member)"
        >
          {{ member.userId === userId ? "Leave" : "Remove" }}
        </button>
      </li>
    </ul>
  </aside>
</template>
