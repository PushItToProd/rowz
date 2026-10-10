<script setup lang="ts">
import { results, exampleCells, byCategory, segments } from "./content";
</script>

<template>
  <div>
    <section id="functions">
      <h2>Functions</h2>
      <p>
        Function names can be typed in any letter case. A parameter in square brackets may be left
        out. In the examples, {{ exampleCells }}.
      </p>
      <p class="help__jump">
        <a
          v-for="{ category } in byCategory"
          :key="category"
          :href="`#functions-${category.toLowerCase()}`"
        >
          {{ category }}
        </a>
      </p>
      <template v-for="{ category, docs } in byCategory" :key="category">
        <h3 :id="`functions-${category.toLowerCase()}`">{{ category }}</h3>
        <table class="help__functions">
          <thead>
            <tr>
              <th>Function</th>
              <th>What it does</th>
              <th>Example</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in docs" :key="doc.name" :data-function="doc.name">
              <td>
                <code>{{ doc.syntax }}</code>
              </td>
              <td>
                <template v-for="(part, index) in segments(doc.summary)" :key="index">
                  <code v-if="part.code">{{ part.text }}</code>
                  <template v-else>{{ part.text }}</template>
                </template>
              </td>
              <td>
                <code>={{ doc.example }}</code>
                <span class="help__result">gives {{ results.get(doc.name) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
  </div>
</template>
