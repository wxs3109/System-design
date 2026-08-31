# Complete estimation exercise

This article uses interview-friendly integers to complete the first calculation, and then explains which assumptions need to be replaced in reality. All numbers are practice inputs and do not represent actual company public sizes or production configurations.

## 1. General answer format

Each question is in the following order:

1. Enter the hypothesis;
2. Average and peak QPS;
3. Daily and cumulative storage;
4. Network bandwidth;
5. Cache, service or partition magnitude;
6. How the conclusion affects the architecture;
7. How to verify in reality.

You don’t have to count every item in your interview. Prioritize the calculation of numbers that will change the design.

---

## 2. News Feed

### Interview assumptions

- 100 million DAU;
- Each person can post 2 pieces of content per day;
- Each person refreshes the feed 20 times per day;
- 20 items returned each time, 1 KB of feed metadata per item;
- Peak is 3 times the average;
- Average 200 followers per piece of content.

### Request volume

Write:

$$\frac{10^8\times2}{10^5}=2,000\text{ writes/s average}$$

Peaks at about 6,000 writes/s.

Feed reads:

$$\frac{10^8\times20}{10^5}=20,000\text{ reads/s average}$$

Peaks at approximately 60,000 reads/s.

### Fan-out workload

If all fan-out on write:

$$2,000\times200=400,000\text{ timeline insertions/s average}$$

The peak value is about 1.2 million times/s. This is two orders of magnitude larger than the original posting QPS, indicating that the fan-out strategy is a core design issue.

### Response bandwidth

Each read is about:

$$20\times1\text{ KB}=20\text{ KB}$$

Peak payload outbound:

$$60,000\times20\text{ KB}=1.2\text{ GB/s}\approx9.6\text{ Gbit/s}$$

Images and videos should not be transmitted through this metadata API, but should go through object storage and CDN.

### Architecture Conclusion

- Feed reading is suitable for caching;
- Fan-out work requires asynchronous queues;
- Celebrity users will destroy the average 200 followers assumption, suitable for push/pull hybrid;
- Timeline storage and original content storage have different access modes.

###Reality Calibration

Measure Follower Distribution instead of just looking at the average; distinguish between Refresh and actual access to Origin; measure Serialized Size, Ranking Service Latency, Cache Hit Ratio and Queue Backlog of each page.

---

## 3. YouTube-like video system

### Interview assumptions

- 100 million DAU;
- 30 minutes of viewing per person per day;
- Average playback bit rate 4 Mbit/s;
- Peak concurrent viewers: 5 million;
- 1 million videos uploaded every day;
- Original files average 100 MB;
- After transcoding, the total size of all versions is 1.5 times that of the original file;
- CDN byte hit rate 95%.

### Playback bandwidth

User side peak value:

$$5\times10^6\times4\text{ Mbit/s}=20\text{ Tbit/s}$$

CDN Origin Traffic：

$$20\text{ Tbit/s}\times5\%=1\text{ Tbit/s}$$

Even if the Byte Hit Ratio is 95%, Origin Traffic is still Tbps level, indicating that Hit Ratio, Origin Shield and Content Pre-warming are very important.

### Upload and store

Original file:

$$10^6\times100\text{ MB}=100\text{ TB/day}$$

Original file plus derivative version:

$$100\times(1+1.5)=250\text{ TB/day}$$

One year’s logical capacity is approximately:

$$250\times365\approx91\text{ PB}$$

Replication, erasure coding, thumbnails, and margins are not included yet.

### Architecture Conclusion

- Separation of media data and metadata;
- The client directly uploads object storage;
- Transcoding via queues and asynchronous workers;
- Playback must rely on CDN;
- Storage cost and network egress are first-class constraints.

###Reality Calibration

The true average bitrate depends on the device, region, and adaptive bitrate; upload size is a heavy-tailed distribution; transcoding amplification depends on the encoding ladder; request hit and byte hit should be measured separately, and use regional concurrency curves instead of DAU to infer a single peak.

---

## 4. Google Maps-like map system

### Interview assumptions

- 50 million DAU;
- 20 map interactions per person per day;
- Get an average of 10 map tiles per interaction;
- Average 50 KB per compressed slice;
- Peak is 4 times the average;
- CDN byte hit rate 98%;
- 10% of users request route planning once a day.

### Slicing request

$$\frac{5\times10^7\times20\times10}{10^5}=100,000\text{ tile requests/s average}$$

Peak is around 400,000 requests/s.

Peak payload on user side:

$$4\times10^5\times50\text{ KB}=20\text{ GB/s}=160\text{ Gbit/s}$$

CDN Origin Traffic About:

$$160\times2\%=3.2\text{ Gbit/s}$$

### Path planning request

$$\frac{5\times10^7\times10\%}{10^5}=50\text{ QPS average}$$

This result appears to be small, suggesting that the hypothesis may be missing persistent reroute in navigation, multiple candidate routes, and internal graph queries. One of the values ​​of interview estimation is discovering that the model is incomplete and then correcting the inputs.

### Architecture Conclusion

- Map tiles are read-ready, cacheable large-scale static distribution;
- The path planning request volume is low but the CPU and memory costs are high, and the capacity cannot be judged only by QPS;
- Real-time traffic updates are separate Stream Processing and Data Freshness issues;
- Spatial zoning needs to take into account regional locality and urban hotspots.

###Reality Calibration

Measure tile requests after zooming, dragging, and caching from client telemetry; differentiate between vector and raster tiles; route planning using real graph scale, route distance, and algorithm benchmarks; measure urban hotspots and morning and evening peaks.

---

## 5. S3 class object storage

### Interview assumptions

- 1 billion objects written every day;
- average object 1 MB;
- Approximately 1 KB metadata per object;
- The number of reads is 10 times that of writes;
- Peak is 3 times the average;
- Data retention for 5 years;
- The data layer uses a redundancy amplification of $1.5\times$ as a practice value.

### Request volume

Write:

$$\frac{10^9}{10^5}=10,000\text{ writes/s average}$$

Peaks at about 30,000 writes/s. Read peak is approximately 300,000 reads/s.

### Data capacity

Daily object data:

$$10^9\times1\text{ MB}=1\text{ PB/day}$$

Five years of logical data:

$$1\text{ PB/day}\times365\times5=1.825\text{ EB}$$

Adding $1.5\times$ redundancy is about 2.74 EB, not yet adding margin and derived overhead.

Metadata Daily:

$$10^9\times1\text{ KB}=1\text{ TB/day}$$

Metadata is much smaller than object data, but it is subject to high-frequency enumeration, listing, and consistency requirements and needs to be designed independently.

### Network throughput

Average write payload:

$$10,000\times1\text{ MB}=10\text{ GB/s}=80\text{ Gbit/s}$$

If the average read is 1 MB, the peak read payload will reach:

$$300,000\times1\text{ MB}=300\text{ GB/s}=2.4\text{ Tbit/s}$$

### Architecture Conclusion

- Separation of data and metadata;
- Both require large-scale sharding;
- Data durability relies on verification, replication or erasure coding and continuous repair;
- Large objects require multipart upload and Range Read;
- Capacity, network, request rate and repair speed must be planned simultaneously.

###Reality Calibration

An average of 1 MB masks a large number of small objects and a small number of very large objects; estimate request rate, capacity, and IOPS should be bucketed by size. Measure LIST to GET/PUT ratio, storage level, delete rate, cross-region replication, and rebuild bandwidth after node or failure domain loss.

---

## 6. Sensitivity analysis

After the interview calculation is completed, select one or two inputs with the greatest uncertainty to make changes:

- Peak factor changed from 3 to 10;
- Cache hit rate dropped from 99% to 90%;
- The average object size changes from 1 MB to 100 KB, but the number of objects increases by 10 times;
- CDN byte hit rate changed from 95% to 90%;
- The stress testing capability of a single machine is only half of the original hypothesis.

If a two-fold change in input requires a complete refactoring, the design may be too fragile. Sensitivity analysis can also indicate which metrics are most worth measuring in production.

## 7. Interview closing template

> The above is an order of magnitude estimate using $10^5$ seconds a day, 3x peak, and several integer object sizes. The key takeaway is that reads are reaching tens of thousands per second, data is entering petabytes, and media bandwidth is much greater than metadata traffic, necessitating caching/CDN, asynchronous processing, and horizontal partitioning. In production I would replace these assumptions with minute-level traffic, object size distributions, P99 latencies, cache hit ratios, and representative stress tests, leaving margin for failure and growth.
