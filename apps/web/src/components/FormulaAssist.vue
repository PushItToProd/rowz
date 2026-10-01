<script setup lang="ts">
import type { FunctionDoc } from "@spreadsheet-app/engine";
import { computed } from "vue";
import type { Suggestion } from "../formula/assist";

const props = defineProps<{
  items: readonly Suggestion[];
  active: number;
  signature: FunctionDoc | undefined;
  /** The input being typed into. The list opens under it. */
  anchor: HTMLElement | undefined;
}>();
defineEmits<{ pick: [suggestion: Suggestion] }>();

const GAP = 2;
const open = computed(() => props.anchor && (props.items.length > 0 || props.signature));
// Fixed to the window, because the grid clips anything that overflows a cell.
const position = computed(() => {
  const rect = props.anchor?.getBoundingClientRect();
  return rect ? { top: `${String(rect.bottom + GAP)}px`, left: `${String(rect.left)}px` } : {};
});
</script>

<template>
  <Teleport to="body">
    <!-- mousedown is prevented so a click here does not take focus from the input and end the edit. -->
    <div v-if="open" class="formula-assist" :style="position" @mousedown.prevent>
      <ul v-if="items.length > 0" role="listbox" aria-label="Suggestions">
        <li
          v-for="(item, index) in items"
          :key="`${item.kind}:${item.label}`"
          role="option"
          :aria-selected="index === active"
          :class="{ 'formula-assist__item--active': index === active }"
          @mousedown="$emit('pick', item)"
        >
          <span class="formula-assist__label">{{ item.label }}</span>
          <span class="formula-assist__detail">{{ item.detail }}</span>
        </li>
      </ul>
      <p v-else-if="signature" class="formula-assist__signature" role="note">
        <code>{{ signature.syntax }}</code>
        {{ signature.summary.replaceAll("`", "") }}
      </p>
    </div>
  </Teleport>
</template>
