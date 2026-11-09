# Data sources

Every outside data file the map uses, where it came from, its terms and its checksum. Read on 8 Nov 2026.

## Census TIGER/Line Shapefiles, 2025

| File | From | Size |
| --- | --- | --- |
| `tl_2025_23005_roads.zip` (Cumberland County, Maine roads) | https://www2.census.gov/geo/tiger/TIGER2025/ROADS/ | 3,529,138 bytes |
| `tl_2025_23005_areawater.zip` (Cumberland County area water) | https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/ | 582,809 bytes |
| `tl_2025_23_arealm.zip` (Maine area landmarks) | https://www2.census.gov/geo/tiger/TIGER2025/AREALM/ | 813,872 bytes |
| `tl_2025_23_tabblock20.zip` (Maine 2020 census blocks, used for block points only) | https://www2.census.gov/geo/tiger/TIGER2025/TABBLOCK20/ | 70,093,660 bytes |

Terms, from the 2025 TIGER/Line Shapefiles Technical Documentation
(https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2025/TGRSHP2025_TechDoc.pdf), chapter 1:

- 1.2 Citation Information: "Copyright protection is not available for any work of the United States Government
  (Title 17 U.S.C., Section 105). Thus, you are free to reproduce census materials as you see fit. We would ask,
  however, that you cite the Census Bureau as the source."
- 1.1 Legal Disclaimers: no warranty as to accuracy; boundaries are for statistical use only. "TIGER/Line" is a
  registered trademark of the Census Bureau and may not be used in a product name. The Census Bureau "requests that
  any repackaging of the TIGER/Line Shapefile data ... for distribution include a conspicuously placed statement to
  this effect" (the trademark statement).
- Suggested citation printed on the document: "2025 TIGER/Line Shapefiles (machine-readable data files) / prepared by
  the U.S. Census Bureau, 2025".

## LEHD Origin-Destination Employment Statistics (LODES), version 8.5

| File | From | Size | SHA-256 of the unpacked CSV |
| --- | --- | --- | --- |
| `me_wac_S000_JT00_2024.csv.gz` (Maine workplace jobs by census block, all jobs, 2024) | https://lehd.ces.census.gov/data/lodes/LODES8/me/wac/ | 303,908 bytes | `427f102f53b23bcc4b5f76f29bad98bcb97370d546100739cb133765748b6d89` (matches the published `.sha256sum`) |

Data vintage from `version.txt`: `20261014_0725`, release format 8.5. Field used: `C000` (total jobs) by `w_geocode`
(workplace census block). Structure: LODES Technical Documentation 8.5
(https://lehd.ces.census.gov/data/lodes/LODES8/LODESTechDoc8.5.pdf).

Citation format the LEHD data page gives (https://lehd.ces.census.gov/data/, "LEHD Data Citations"):
`U.S. Census Bureau, "{File Name}," LEHD Origin-Destination Employment Statistics, {Vintage},
https://lehd.ces.census.gov/data/lodes, accessed on {Date}.` For this file:
U.S. Census Bureau, "me_wac_S000_JT00_2024," LEHD Origin-Destination Employment Statistics, 8.5,
https://lehd.ces.census.gov/data/lodes, accessed on November 8, 2026.

## Credit line

The owner approved it on 9 Nov 2026. The credit line shows in four places:

1. `web/src/map/CityMap.tsx`: the short line `Map data: U.S. Census Bureau (TIGER/Line 2025, LODES 8.5).` as the last item of the map legend bar.
2. `web/src/studio/widgets.tsx`: the short line in the Studio map key.
3. `web/src/pages/About.tsx`: a `## Map data` section with the long block citation and trademark statement.
4. `README.md`: a `## Map data` section with the long block citation and trademark statement.
