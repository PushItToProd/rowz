-- A kept version holds a spreadsheet file, whose pages list what is on them
-- under "blocks". Versions kept while that key was "items" are rewritten.
UPDATE "versions"
SET "data" = jsonb_set(
	"data",
	'{pages}',
	(
		SELECT jsonb_agg(
			CASE
				WHEN "page" ? 'items' THEN ("page" - 'items') || jsonb_build_object('blocks', "page" -> 'items')
				ELSE "page"
			END
			ORDER BY "place"
		)
		FROM jsonb_array_elements("data" -> 'pages') WITH ORDINALITY AS "listed" ("page", "place")
	)
)
WHERE jsonb_path_exists("data", '$.pages[*].items');
