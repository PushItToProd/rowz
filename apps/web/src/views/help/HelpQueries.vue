<script setup lang="ts">
import { segments, QUERY_CLAUSES, QUERY_TESTS } from "./content";
</script>

<template>
  <div>
    <section id="query">
      <h2>Queries</h2>
      <p>
        <code>QUERY</code> picks, filters, groups, and sorts the rows of a range with a query
        written like SQL:
      </p>
      <pre><code>=QUERY(A1:D99, "select B, sum(C) where D >= date ""2026-01-01"" group by B order by sum(C) desc")</code></pre>
      <p>
        A column is named by its letter, counting from the first column of the range, so in
        <code>QUERY(C1:E9, …)</code> column C is <code>A</code>. A column with a header can also be
        named by it: <code>select Amount</code>. Headers with spaces or reserved words and aliases
        go in single quotes: <code>select 'Sold on'</code>. Double an apostrophe inside an
        identifier. Strings, date literals, and label text use double quotes only. Double each query
        double quote inside the formula string:
        <code>=QUERY(People, "select * where 'Favorite food' = ""Pizza""")</code>. A double quote
        inside query text is doubled again:
        <code>=QUERY(People, "select * where Note = ""say """"hello""""""")</code>
        matches <code>say "hello"</code>. Backslashes do not escape quotes.
      </p>
      <p>
        A data table carries its column names into a query, without a header row in its data. For
        example, <code>=QUERY(Sales, "select Category, sum(Amount) group by Category")</code> can
        use those names and returns them as headings. The same works for a named-column range such
        as <code>Sales!A:C</code>.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Clause</th>
            <th scope="col">What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[clause, meaning] in QUERY_CLAUSES" :key="clause">
            <td>
              <code>{{ clause }}</code>
            </td>
            <td>
              <template v-for="(part, index) in segments(meaning)" :key="index">
                <code v-if="part.code">{{ part.text }}</code>
                <template v-else>{{ part.text }}</template>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th scope="col">Test</th>
            <th scope="col">What it matches</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[test, meaning] in QUERY_TESTS" :key="test">
            <td>
              <code>{{ test }}</code>
            </td>
            <td>
              <template v-for="(part, index) in segments(meaning)" :key="index">
                <code v-if="part.code">{{ part.text }}</code>
                <template v-else>{{ part.text }}</template>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <ul>
        <li>
          A query can call any function a formula can:
          <code>select UPPER(A), MONTH(D) where LEN(A) > 3</code>.
        </li>
        <li>
          A first row of text above numbers or dates is taken to be a header row, and the result
          starts with a header row too. Give the number of header rows as a third argument to say
          otherwise: <code>QUERY(A1:D99, "select A", 0)</code>.
        </li>
        <li>
          The result fills cells like any other formula with several values, and a text view shows
          it as a table.
        </li>
      </ul>
    </section>
  </div>
</template>
