import fetch from 'node-fetch';
import * as fs from 'fs';
import { parse, writeToStream } from 'fast-csv';

type OutputDataSchemaRow = {
  block_number: number;
  timestamp: number;
  user_address: string;
  token_address: string;
  token_balance: number;
};

interface BlockData {
  blockNumber: number;
  blockTimestamp: number;
}

const LOGX_SUBGRAPH_QUERY_URL = 'https://api.goldsky.com/api/public/project_clxspa1gpqpvl01w65jr93p57/subgraphs/LlpManager-linea/1.0.2/gn';
const PAGE_SIZE = 1000;

const post = async (url: string, data: any): Promise<any> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(data),
  });
  return await response.json();
};

const getPoolData = async (blockNumber: number, skipPage: number, blockTimestamp?: number): Promise<OutputDataSchemaRow[]> => {
  const LOGX_POOL_QUERY = `
    query LiquidityQuery {
      addLiquidities(
        skip: ${skipPage}
        first: ${PAGE_SIZE}, 
        where: { block_number: ${blockNumber}},
      ) {
        id
        account
        token
        amount
        llpSupply
        timestamp_
      }
    }
  `;
  const csvRows: OutputDataSchemaRow[] = [];
  const responseJson = await post(LOGX_SUBGRAPH_QUERY_URL, { query: LOGX_POOL_QUERY });

  for (const item of responseJson.data.addLiquidities) {
    csvRows.push({
      block_number: blockNumber,
      timestamp: item.timestamp_,
      user_address: item.account,
      token_address: item.token,
      token_balance: item.amount,
    });
  }

  // Check if there are more records to fetch recursively
  if (responseJson.data.addLiquidities.length === PAGE_SIZE) {
    const nextPageRows = await getPoolData(blockNumber, skipPage + PAGE_SIZE, blockTimestamp);
    csvRows.push(...nextPageRows);
  }

  return csvRows;
};

export const getUserTVLByBlock = async (blocks: BlockData) => {
  const { blockNumber, blockTimestamp } = blocks;
  // Retrieve data using block number and timestamp
  const csvRows = await getPoolData(blockNumber, 0, blockTimestamp);
  return csvRows;
};

const readBlocksFromCSV = async (filePath: string): Promise<BlockData[]> => {
  const blocks: BlockData[] = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(parse({ headers: true }))
      .on('error', error => reject(error))
      .on('data', (row: any) => {
        const blockNumber = parseInt(row.block_number, 10);
        const blockTimestamp = parseInt(row.timestamp, 10);
        if (!isNaN(blockNumber) && blockTimestamp) {
          blocks.push({ blockNumber, blockTimestamp });
        }
      })
      .on('end', () => resolve(blocks));
  });
};

const fetchAndWriteToCsv = async (filePath: string, blocks: BlockData[]) => {
  const allCsvRows: OutputDataSchemaRow[] = [];

  for (const block of blocks) {
    try {
      const result = await getUserTVLByBlock(block);
      allCsvRows.push(...result);
    } catch (error) {
      console.error(`An error occurred for block ${block.blockNumber}:`, error);
    }
  }

  const fileExists = fs.existsSync(filePath);
  const ws = fs.createWriteStream(filePath, { flags: 'a' });

  writeToStream(ws, allCsvRows, { headers: !fileExists, includeEndRowDelimiter: true })
    .on('finish', () => {
      console.log(`CSV file '${filePath}' has been written successfully.`);
    });
};

const inputFilePath = 'Test/inputData.csv';
const outputFilePath = 'Test/outputData.csv';

readBlocksFromCSV(inputFilePath).then(async (blocks) => {
  await fetchAndWriteToCsv(outputFilePath, blocks);
}).catch((err) => {
  console.error('Error reading CSV file:', err);
});