# Local reporting libraries

Delegated ruling: retain the existing baseline versions because the published
packages are available, AutoTable explicitly supports jsPDF 4, and this avoids an
unnecessary chart version change. This implements the authorized continuation of
the missing PDF/chart dependency work; no deployment is authorized here.

Browser scripts are exact, unmodified distribution members from the official npm
registry packages: Chart.js 4.4.7, jsPDF 4.2.1, and jsPDF-AutoTable 5.0.8.
Each package archive's SHA512 was checked against its registry metadata before
copying these files. No package installation or lifecycle script was run.
`manifest.json` records retrieval time, package URLs, archive integrity, and each
script/license file's SHA256 and byte count. The adjacent LICENSE files and
embedded distribution notices retain the MIT notices.

`index.html` loads the local UMD scripts with `defer`, in the order Chart.js,
jsPDF, AutoTable, before the deferred application scripts. The existing same-origin
Content Security Policy is unchanged. These libraries require no remote request
for the app's canvas charts and text/table PDF exports. Optional jsPDF HTML/SVG
rendering dependencies are not included or used by these exports.

Official references checked for this change:

- [Chart.js script integration](https://www.chartjs.org/docs/latest/getting-started/integration.html)
  documents the UMD browser distribution.
- [AutoTable 5.0.8 package metadata](https://registry.npmjs.org/jspdf-autotable/5.0.8)
  declares the jsPDF peer range `^2 || ^3 || ^4`.
- [AutoTable usage](https://github.com/simonbengtsson/jsPDF-AutoTable)
  documents browser script loading and the table API.
- [jsPDF browser usage](https://github.com/parallax/jsPDF)
  documents the UMD global and PDF text/save API.
- [jsPDF releases](https://github.com/parallax/jsPDF/releases)
  lists 4.2.1 fixes for HTML injection in output methods and PDF object injection
  through free-text annotation colors; an older jsPDF was not substituted.
- [Chart.js security page](https://github.com/chartjs/Chart.js/security)
  showed no published project advisories at review time. This is a scoped source
  check, not a claim that all possible vulnerabilities have been ruled out.

Source map files are intentionally omitted; upstream sourceMappingURL comments
are retained to keep the distribution bytes unchanged. Opening developer tools
may request those absent maps; they are not needed at runtime.
