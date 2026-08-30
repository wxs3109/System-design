# Storage capacity estimate

## 1. Basic model

$$\text{Raw Storage}=\text{Records per Day}\times\text{Bytes per Record}\times\text{Retention Days}$$

The total physical space also includes:

$$\text{Physical Storage}=\text{Raw Data}+\text{Indexes}+\text{Replicas}+\text{Metadata}+\text{Headroom}$$

Don’t equate “user uploads 1 PB” directly with “buy 1 PB disk.”

## 2. Estimate a single record

Split the fields first, not necessarily byte by byte:

| Fields | Interview Estimates | Realistic Considerations |
|---|---:|---|
| 64-bit ID | 8 B | Encoding, nullable, and alignment may add overhead |
| Timestamp | 8 B | Precision and database type differ |
| Status/Enumeration | 1–4 B | Row formats may be stored in larger units |
| Short strings | Average actual length | Also includes length, encoding and line overhead |
| UUID text | Around 36 Bytes | Binary storage typically 16 Bytes |
| JSON | By typical payload | Field names, compression and parsing formats have a great impact |

A common metadata record can be 0.5 KB, 1 KB, or 2 KB in the interview. The point is to name the components and sensitive fields. Realistically the average, P95 and maximum should be measured from production samples; long-tail objects may determine network and memory risks.

## 3. Metadata example

Assume that 100 million records are added every day, each approximately 1 KB, and retained for 5 years:

$$10^8\times10^3=10^{11}\text{ B/day}=100\text{ GB/day}$$

$$100\text{ GB/day}\times365\times5\approx182.5\text{ TB}$$

The interview can be approximated as 180 TB of raw data. If you add 50% index, 3 copies, and leave 30% margin:

$$180\times1.5\times3\times1.3\approx1.05\text{ PB}$$

The takeaway here is that physical capacity goes into the petabyte range, not exactly 1.05 petabytes of procurement.

## 4. Large object example

Assume that 1 million videos are uploaded every day and the average original file is 100 MB:

$$10^6\times100\text{ MB}=100\text{ TB/day}$$

Realistic video systems also generate multiple codecs, resolutions, thumbnails, and subtitles. The transcoding amplification factor can be defined:

$$\text{Stored Media}=\text{Source Bytes}\times(1+\text{Derived Ratio})$$

If the derivatives add up to 1.5 times the size of the original file, the total volume is 2.5 times the size of the source file, or 250 TB/day. This ratio must be measured based on the encoding ladder and retention strategy and cannot be treated as a universal constant.

## 5. Index space

Index size depends on index keys, row locators, compression, cardinality, and data structure. When the interview does not have schema details, you can:

- Simple metadata systems first assume that the index is 20%–50% of the original data;
- The search or analysis system may come close to or even exceed the original data;
- Explicitly include it as a sensitivity parameter.

In reality, query performance may also vary by orders of magnitude depending on whether the Index can reside in memory, so in addition to disk space, it is also necessary to estimate the Active Index Working Set.

## 6. Replication and Erasure Coding

Storage Amplification for three copies is about $3\times$. Erasure Coding For example, the theoretical enlargement of $(k+m)$ is:

$$\frac{k+m}{k}$$

For example, $k=10,m=4$, the theoretical amplification is $1.4\times$. In reality, small object packaging, fragmentation, Repair Space, Checksum and Metadata also need to be considered. Erasure Coding saves capacity but usually increases the complexity of encoding, Read Reconstruction and Repair.

## 7. Hot, warm and cold data

Don't assume that all historical data requires the same performance. Estimate separately:

- Hot data: frequently accessed, usually placed on high-performance media and possibly cached;
- Warm data: occasional access, cost and latency trade-offs;
- Cold data: archived, slow to read but low cost;
- Deletable data: Subject to TTL, user deletion and compliance requirements.

If only 1% of the data in the last 7 days is frequently read, cache and high-performance storage should be estimated around the Working Set rather than the entire historical capacity.

## 8. Growth, headroom and recovery space

Production capacity needs to be reserved:

- Future growth and purchasing cycles;
- Compaction, temporary files and background migration;
- Replica reconstruction after node failure;
- Old and new data overlap during rebalancing;
- Backups, snapshots and cross-region copies;
- Cannot run at close to 100% disk utilization for long periods of time.

A margin of 20%–30% can be used as a convenient assumption during interviews; realistic thresholds are determined by system behavior, speed of expansion, and failure recovery time.

## 9. Capacity and throughput must be viewed together

A node may fit on the disk, but not be able to handle IOPS, sequential throughput, or network traffic. Conversely, carving out many nodes for throughput can create a lot of idle capacity. Consider at least also:

- Read and write operations per second and request size;
- Sequential or random access;
- Compression, Compaction and Write Amplification;
- Replica and recovery traffic;
- Whether Working Set can be put into memory.

## 10. Checklist

- [ ] Is the single size the payload or the full persistence size?
- [ ] Are daily new increments and cumulative amounts separate?
- [ ] Are retention periods, deletions, and hot and cold tiering clear?
- [ ] Are Index, Derived Data, Replica, and Backup calculated?
- [ ] Is there room for migration, repair, and growth?
- [ ] Are the three dimensions of capacity, IOPS and bandwidth checked?
