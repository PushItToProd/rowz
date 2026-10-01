# Functions Rows offered, and which of them this app has

Rows documented about 480 functions at <https://rows.com/docs/category/functions>. About 250 of them call a specific outside service (ad platforms, CRMs, Stripe, Google Maps, stock data) and 17 call a language model. This page sorts the rest by what this app does with them.

The list was read from the Rows documentation index on 2026-09-30. Signatures for the action and automation functions come from the Rows articles "Expanding data cells and Insert to other tables", "Scheduling and repeating actions", and "Using QUERY and understanding the Query Language".

## Present

| Area        | Functions                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Math        | `SUM AVERAGE MIN MAX PRODUCT MEDIAN COUNT COUNTA SUMPRODUCT SUMIF SUMIFS COUNTIF COUNTIFS MAXIFS MINIFS MOD POWER SQRT EXP LN LOG PI SIGN TRUNC MROUND QUOTIENT EVEN ODD ISEVEN ISODD GCD LCM FACT` |
| Statistics  | `MODE STDEV STDEVP VAR_S VAR_P PERCENTILE QUARTILE RANK CORREL COUNTUNIQUE COUNTBLANK`                                                                                                              |
| Text        | `CONCATENATE CONCAT TEXTJOIN JOIN SPLIT SUBSTITUTE TRIM PROPER UPPER LOWER LEN LEFT RIGHT MID FIND SEARCH REPT CHAR CODE ENCODEURL TEXT FIXED VALUE`                                                |
| Lookup      | `VLOOKUP HLOOKUP XLOOKUP INDEX MATCH ROW COLUMN`                                                                                                                                                    |
| Arrays      | `FILTER SORT UNIQUE SEQUENCE TRANSPOSE FLATTEN QUERY`                                                                                                                                               |
| Dates       | `DATE TIME DATEVALUE ISDATE DAYS DATEDIF EDATE EOMONTH YEAR MONTH DAY WEEKDAY WEEKNUM ISOWEEKNUM HOUR MINUTE SECOND WORKDAY NETWORKDAYS TODAY NOW`                                                  |
| Logic       | `IF IFS SWITCH IFERROR IFNA AND OR NOT`                                                                                                                                                             |
| Type checks | `ISTEXT ISNUMBER ISBLANK ISLOGICAL ISERROR ISERR ISNA ISNONTEXT`                                                                                                                                    |
| Actions     | `BUTTON EXECUTE SEND_EMAIL CLEAR`                                                                                                                                                                   |

`QUERY` follows the language Rows documented, with the differences recorded in DECISIONS.md. Rows' `APPEND` stacks tables; here that is `VSTACK`. Rows' `INSERT(data, destination)` appends rows to a table; here `APPEND_ROW(range, value, ...)` appends one row.

## Candidates, most useful first

1. **`UPDATE(data, keys, destination)` and `OVERWRITE(data, destination)`.** `UPDATE` inserts rows whose key columns are new and updates the rows whose keys already exist. `OVERWRITE` replaces the destination with the data. With `INSERT` these are how Rows turned a button or a schedule into a data pipeline. `INSERT` of several rows at once is also missing: `APPEND_ROW` takes one.
2. **`SCHEDULE(task, schedule, [time_zone])`, `REPEAT`, and `REFRESH(range, [interval], [unit], [delay])`.** Run an action on a timer without a click. This needs a scheduler on the server and a decision about whose permissions a scheduled action runs with.
3. **Regular expressions: `REGEXMATCH`, `REGEXEXTRACT`, `REGEXREPLACE`.** Held back on purpose. See below.
4. **Financial: `PMT PV FV NPV IRR RATE NPER IPMT PPMT`.** Self-contained arithmetic. Worth adding when someone builds a loan or investment sheet.
5. **Reference functions: `OFFSET`, `INDIRECT`, `ADDRESS`, `ISFORMULA`, `ISREF`.** `OFFSET` and `INDIRECT` produce references at evaluation time, which the dependency graph cannot see in advance. They need the graph to re-plan after evaluation, as array spills already do.
6. **Random numbers: `RAND`, `RANDBETWEEN`, `RANDARRAY`.** Each client and the server evaluate formulas separately, so each would see a different number. A button that used one would act on a number the user never saw. They need a seed stored with the spreadsheet.
7. **Date helpers: `YEARFRAC`, `TIMEVALUE`, `TO_DATE`, `UNIXTIME`, `UNIX2DATE`, `TO_TIMEZONE`, and the ranges `LASTXDAYS`, `LASTXWEEKS`, `LASTXMONTHS`, `DATEINTERVAL`.** Small. `TO_TIMEZONE` needs a decision first, because dates here carry no time zone.
8. **More statistics: `PEARSON SLOPE INTERCEPT FORECAST COVARIANCE_S COVARIANCE_P SKEW RANK_AVG RANK_EQ`.** Small. `PEARSON` is `CORREL` under another name.
9. **Trigonometry: `SIN COS TAN ASIN ACOS ATAN SINH COSH TANH DEGREES RADIANS`.** Trivial to add. Left out until someone wants them.
10. **Other text: `SLICE`, `SLUGIFY`, `DECODEURL`, `BASE64`, `BASE64DECODE`, `DOMAIN`, `RELATIVE_URL`.** Small.
11. **`LOOKUP`, `XYLOOKUP`, `FLOOKUP`.** `XYLOOKUP` finds a cell by a row key and a column key. `FLOOKUP` is a fuzzy match.
12. **`SUBTOTAL`, `ARRAY_CONSTRAIN`, `FILTER_COLUMNS`, `RANGE_CONTAINS`.** `TAKE` covers `ARRAY_CONSTRAIN`.

## Not planned

| Functions                                                                                                                                                   | Reason                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `*_AI`, `AI`, `ASK_AI`, `RESEARCH_AI_AGENT`                                                                                                                 | Out of scope for this project.                                                                                                                               |
| `GET_*`, `SEARCH_*`, `*_STRIPE`, `*_HUBSPOT`, `*_GOOGLE`, `*_ALPHAVANTAGE`, and the other service functions                                                 | Each belongs to one outside service.                                                                                                                         |
| `QUERY_MYSQL`, `QUERY_POSTGRESQL`, `QUERY_BIGQUERY`, `QUERY_SNOWFLAKE`, `QUERY_REDSHIFT`                                                                    | Outside databases.                                                                                                                                           |
| `GET`, `POST`, `PUT`, `PATCH`, and the JSON functions `PARSE`, `FROM_JSON`, `RANGE2JSON`, `PAIR2JSON`, `TRANSPOSE_JSON`, `UNNEST`, `EXPAND`, `REMOVEARRAYS` | Generic HTTP from a formula is the base of every integration. It is deferred with integrations, and it needs a policy for which hosts the server may call.   |
| `PYTHON`                                                                                                                                                    | Runs code on the server.                                                                                                                                     |
| `MD5`, `SHA256`, `HMAC_SHA256`                                                                                                                              | Hashing is synchronous in Node and asynchronous in the browser, and the engine runs in both without I/O. They would need a hash written in plain TypeScript. |
| `ARRAYFORMULA`                                                                                                                                              | Arithmetic on ranges already works cell by cell.                                                                                                             |
| `EQ NE GT GTE LT LTE`, `POW`, `N`, `SQRTPI`                                                                                                                 | The operators and `POWER` cover them.                                                                                                                        |
| `NORMINV ZTEST BINOMDIST T.INV T.INV.2T SERIESSUM COMBIN COMBINA BASE DECIMAL SUMSQ SUMX2MY2 SUMX2PY2 SUMXMY2 SEC SECH COT COTH ACOT ACOTH`                 | Specialist math.                                                                                                                                             |
| `LOG10`                                                                                                                                                     | The name is also a cell address, and a call written on a cell address calls the function that cell holds. `LOG(x)` uses base 10.                             |

## Regular expressions

`REGEXMATCH`, `REGEXEXTRACT`, and `REGEXREPLACE` are the most useful functions not added. JavaScript's regular expression engine backtracks, and a pattern such as `(a+)+$` takes exponential time on some inputs. The server evaluates a spreadsheet's formulas when a button is clicked, so one such formula would stall the server for every user. Adding these functions needs an engine with a time bound, such as RE2, that runs both in the browser and in Node.
