# Back-of-the-Envelope template

## Enter hypothesis

- User size and activity ratio
- Number of operations per user per day
- Read and write ratio and peak factor
- Single record or object size
- Data retention period

## Need to calculate

- Average QPS and peak QPS
- Daily new data and accumulated storage
- Inbound and outbound bandwidth
- Cache size and hit rate targets
- Rough number of services, partitions or disks

## Reasonability check

- Are the units unified?
- Is the average value mistaken for the peak value?
- Do you differentiate between original data, copies, indexes and metadata?
- Are key assumptions clearly documented?
