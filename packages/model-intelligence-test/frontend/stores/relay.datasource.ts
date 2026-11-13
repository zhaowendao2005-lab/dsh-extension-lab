// Routing boundary: relay directory, partitions (favorites) and relay settings go through this datasource only.
export {
  readRow, readRows, readSites, readSnapshot, readHistory, readConcurrency, readSvg,
  listPartitions, savePartition, deletePartition, updatePartitionItem, resolveChannels, retryMissingPages, readTags, writeTags,
} from '../service/relay.service';
