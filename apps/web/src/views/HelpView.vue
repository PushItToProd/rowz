<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import ContextMenu from "../components/ContextMenu.vue";
import type { MenuItem } from "../components/menu";
import { usePageTitle } from "../pageTitle";
import { HELP_PAGES } from "./help/pages";
import Editing from "./help/HelpEditing.vue";
import Tables from "./help/HelpTables.vue";
import Formulas from "./help/HelpFormulas.vue";
import Functions from "./help/HelpFunctions.vue";
import Queries from "./help/HelpQueries.vue";
import Actions from "./help/HelpActions.vue";
import Presentation from "./help/HelpPresentation.vue";
import Documents from "./help/HelpDocuments.vue";

const props = withDefaults(defineProps<{ topic?: string }>(), { topic: "editing" });
const page = computed(() => HELP_PAGES.find(({ id }) => id === props.topic) ?? HELP_PAGES[0]);
const components = {
  editing: Editing,
  tables: Tables,
  formulas: Formulas,
  functions: Functions,
  queries: Queries,
  actions: Actions,
  presentation: Presentation,
  documents: Documents,
};
const router = useRouter();
const topicMenu = ref<{ x: number; y: number }>();
const topicItems = computed<MenuItem[]>(() =>
  HELP_PAGES.map((item) => ({
    label: item.title,
    disabled: item.id === page.value.id,
    async run() {
      await router.push({ name: "help", params: { topic: item.id } });
    },
  })),
);

function openTopicMenu(event: MouseEvent): void {
  if (topicMenu.value) {
    topicMenu.value = undefined;
    return;
  }
  const button = event.currentTarget;
  if (!(button instanceof HTMLElement)) return;
  button.focus({ preventScroll: true });
  const box = button.getBoundingClientRect();
  topicMenu.value = { x: box.left, y: box.bottom + 4 };
}

function resize(): void {
  topicMenu.value = undefined;
  trackSection();
}

const content = ref<HTMLElement>();
const sectionContents = ref<HTMLElement>();
const stickyBar = ref<HTMLElement>();
const sections = ref<{ id: string; title: string }[]>([]);
const reading = ref("");

function trackSection(): void {
  const line = (stickyBar.value?.getBoundingClientRect().bottom ?? 0) + 24;
  const passed = sections.value.filter(({ id }) => {
    const heading = document.getElementById(id);
    return heading && heading.getBoundingClientRect().top <= line;
  });
  const atEnd =
    window.scrollY > 0 &&
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  reading.value =
    (atEnd ? sections.value.at(-1) : passed.at(-1))?.id ?? sections.value[0]?.id ?? "";
}

function scrollContents(event: WheelEvent): void {
  const list = sectionContents.value;
  if (!list || event.ctrlKey || event.deltaX !== 0 || event.deltaY === 0) return;
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? list.clientWidth : 1;
  list.scrollLeft += event.deltaY * unit;
}

async function collectSections(): Promise<void> {
  await nextTick();
  sections.value = Array.from(
    content.value?.querySelectorAll<HTMLElement>("section > h2, h3[id]") ?? [],
  ).map((heading) => ({
    id: heading.id || (heading.parentElement?.id ?? ""),
    title: heading.textContent.trim(),
  }));
  trackSection();
}

watch(() => page.value.id, collectSections);
watch(reading, async () => {
  await nextTick();
  const list = sectionContents.value;
  const link = list?.querySelector<HTMLElement>('[aria-current="location"]');
  if (list && link) list.scrollLeft = link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2;
});
onMounted(() => {
  void collectSections();
  window.addEventListener("scroll", trackSection, { passive: true });
  window.addEventListener("resize", resize);
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", trackSection);
  window.removeEventListener("resize", resize);
});

usePageTitle(() => `${page.value.title} · Help`);
</script>

<template>
  <div id="help-top" class="help">
    <header class="help__header">
      <RouterLink :to="{ name: 'spreadsheets' }">← Documents</RouterLink>
      <h1>Help</h1>
    </header>
    <nav class="help__contents" aria-label="Help topics">
      <RouterLink
        v-for="item in HELP_PAGES"
        :key="item.id"
        :to="{ name: 'help', params: { topic: item.id } }"
        :aria-current="item.id === page.id ? 'page' : undefined"
        >{{ item.title }}</RouterLink
      >
    </nav>
    <div ref="stickyBar" class="help__sticky" @wheel="scrollContents">
      <button
        class="help__topics-button help__top"
        type="button"
        aria-label="Help topics"
        aria-haspopup="menu"
        :aria-expanded="Boolean(topicMenu)"
        @click="openTopicMenu"
        @contextmenu.prevent="openTopicMenu"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <nav ref="sectionContents" class="help__sections" aria-label="Contents">
        <a
          v-for="section in sections"
          :key="section.id"
          :href="`#${section.id}`"
          :aria-current="section.id === reading ? 'location' : undefined"
          >{{ section.title }}</a
        >
      </nav>
      <a class="help__top" href="#help-top" aria-label="Back to top">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M5 4h14M12 20V8m-6 6 6-6 6 6" />
        </svg>
      </a>
    </div>
    <ContextMenu
      v-if="topicMenu"
      :x="topicMenu.x"
      :y="topicMenu.y"
      label="Help topics"
      :items="topicItems"
      @close="topicMenu = undefined"
    />
    <div ref="content"><component :is="components[page.id]" /></div>
    <nav class="help__pagination" aria-label="More help topics">
      <RouterLink
        v-if="HELP_PAGES.indexOf(page) > 0"
        :to="{ name: 'help', params: { topic: HELP_PAGES[HELP_PAGES.indexOf(page) - 1]!.id } }"
        >← {{ HELP_PAGES[HELP_PAGES.indexOf(page) - 1]!.title }}</RouterLink
      >
      <RouterLink
        v-if="HELP_PAGES.indexOf(page) < HELP_PAGES.length - 1"
        :to="{ name: 'help', params: { topic: HELP_PAGES[HELP_PAGES.indexOf(page) + 1]!.id } }"
        >{{ HELP_PAGES[HELP_PAGES.indexOf(page) + 1]!.title }} →</RouterLink
      >
    </nav>
  </div>
</template>
