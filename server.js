import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { uri: mongoUri, fallbackUri } = buildMongoConfig();
const mongoDbName = process.env.MONGODB_DB || 'LibreChat';
const MESSAGE_TABLE_LIMIT = 50;

if (!mongoUri) {
  console.warn('Warning: MongoDB connection details are missing. Configure environment variables before starting the server.');
}

let client = mongoUri
  ? new MongoClient(mongoUri, {
      maxPoolSize: 10
    })
  : null;

function buildMongoConfig() {
  const directUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (directUri) {
    return { uri: directUri, fallbackUri: null };
  }

  const host = process.env.MONGODB_HOST;
  const port = process.env.MONGODB_PORT || '27017';
  const username = process.env.MONGODB_USERNAME;
  const password = process.env.MONGODB_PASSWORD;
  const dbName = process.env.MONGODB_DB || 'LibreChat';
  const authSource = process.env.MONGODB_AUTH_SOURCE;

  if (!host) {
    return { uri: null, fallbackUri: null };
  }

  const credentialsPresent = Boolean(username && password);

  const credentials = credentialsPresent
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : '';

  const query = authSource ? `?authSource=${encodeURIComponent(authSource)}` : '';

  const uri = `mongodb://${credentials}${host}:${port}/${dbName}${query}`;

  return {
    uri,
    fallbackUri: credentialsPresent ? `mongodb://${host}:${port}/${dbName}` : null
  };
}

function parseDateInput(value, boundary = 'start') {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (boundary === 'start') {
    date.setHours(0, 0, 0, 0);
  } else if (boundary === 'end') {
    date.setHours(23, 59, 59, 999);
  }

  return date;
}

function buildDateRangeQuery(field, startDate, endDate) {
  if (!startDate && !endDate) {
    return null;
  }

  const range = {};
  if (startDate) {
    range.$gte = startDate;
  }
  if (endDate) {
    range.$lte = endDate;
  }

  return { [field]: range };
}

function createDateMatchStage(field, startDate, endDate) {
  const conditions = [{ [field]: { $type: 'date' } }];
  if (startDate) {
    conditions.push({ [field]: { $gte: startDate } });
  }
  if (endDate) {
    conditions.push({ [field]: { $lte: endDate } });
  }

  return {
    $match: conditions.length > 1 ? { $and: conditions } : conditions[0]
  };
}

function uniqueObjectIds(values = []) {
  const map = new Map();
  values.forEach((value) => {
    if (!value) {
      return;
    }

    const key = value.toString();
    if (!map.has(key)) {
      map.set(key, value);
    }
  });

  return Array.from(map.values());
}

function getUserDisplayName(userDoc) {
  if (!userDoc) {
    return 'Unknown';
  }

  const nameField = userDoc.name;
  const personalization = userDoc.personalization?.profile || {};

  let firstName = typeof personalization.firstName === 'string' ? personalization.firstName.trim() : '';
  let lastName = typeof personalization.lastName === 'string' ? personalization.lastName.trim() : '';

  if (typeof nameField === 'object' && nameField !== null) {
    if (!firstName && typeof nameField.first === 'string') {
      firstName = nameField.first.trim();
    }
    if (!lastName && typeof nameField.last === 'string') {
      lastName = nameField.last.trim();
    }
  }

  if ((!firstName || !lastName) && typeof nameField === 'string' && nameField.trim()) {
    const parts = nameField.trim().split(/\s+/).filter(Boolean);
    if (!firstName && parts.length) {
      firstName = parts[0];
    }
    if (!lastName && parts.length > 1) {
      lastName = parts[parts.length - 1];
    }
  }

  const combined = `${firstName ?? ''} ${lastName ?? ''}`.trim();
  if (combined) {
    return combined;
  }

  if (firstName) {
    return firstName;
  }

  if (lastName) {
    return lastName;
  }

  if (typeof nameField === 'string' && nameField.trim()) {
    return nameField.trim();
  }

  if (typeof userDoc.username === 'string' && userDoc.username.trim()) {
    return userDoc.username.trim();
  }

  if (typeof userDoc.email === 'string' && userDoc.email.trim()) {
    return userDoc.email.trim();
  }

  return 'Unknown';
}

async function getDb() {
  if (!client) {
    throw new Error('MongoDB client is not configured. Set MONGODB_URI or individual connection variables.');
  }

  if (!client.topology || !client.topology.isConnected()) {
    try {
      await client.connect();
    } catch (error) {
      if (isAuthenticationError(error)) {
        console.error('MongoDB authentication failed. Verify your username/password and ensure special characters are percent-encoded.');
        if (fallbackUri) {
          console.warn('Retrying MongoDB connection without credentials because the target deployment may not require authentication.');
          try {
            await client.close().catch(() => {});
            client = new MongoClient(fallbackUri, { maxPoolSize: 10 });
            await client.connect();
          } catch (fallbackError) {
            if (isAuthenticationError(fallbackError)) {
              console.error('Fallback unauthenticated MongoDB connection also failed.');
            }
            throw fallbackError;
          }
          return client.db(mongoDbName);
        }
      }
      throw error;
    }
  }
  return client.db(mongoDbName);
}

function isAuthenticationError(error) {
  return error?.code === 18 || error?.codeName === 'AuthenticationFailed';
}

app.get('/api/health', async (_req, res) => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const db = await getDb();
    const usersCollection = db.collection('users');
    const agentsCollection = db.collection('agents');
    const messagesCollection = db.collection('messages');
    const startDate = parseDateInput(req.query.startDate, 'start');
    const endDate = parseDateInput(req.query.endDate, 'end');

    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ error: 'Invalid date range: startDate must be before endDate.' });
    }

    const messageCountQuery = buildDateRangeQuery('createdAt', startDate, endDate) ?? {};

    const [totalUsers, totalAgents, totalMessages] = await Promise.all([
      usersCollection.countDocuments(),
      agentsCollection.countDocuments(),
      messagesCollection.countDocuments(messageCountQuery)
    ]);

    const agentsPerCategoryPromise = agentsCollection
      .aggregate([
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 }
          }
        },
        {
          $lookup: {
            from: 'agentcategories',
            localField: '_id',
            foreignField: 'value',
            as: 'categoryDocs'
          }
        },
        {
          $addFields: {
            category: {
              $cond: {
                if: { $gt: [{ $size: '$categoryDocs' }, 0] },
                then: { $arrayElemAt: ['$categoryDocs.label', 0] },
                else: {
                  $ifNull: ['$_id', 'Uncategorized']
                }
              }
            }
          }
        },
        {
          $project: {
            _id: 0,
            category: 1,
            count: 1
          }
        },
        { $sort: { count: -1 } }
      ])
      .toArray();

    const messagesPerUserPromise = (async () => {
      const pipeline = [
        createDateMatchStage('createdAt', startDate, endDate),
        { $group: { _id: '$user', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 }
      ];
      const grouped = await messagesCollection.aggregate(pipeline).toArray();

      const userIds = uniqueObjectIds(grouped.map((item) => item._id).filter(Boolean));
      const userDocs = userIds.length
        ? await usersCollection
            .find({ _id: { $in: userIds } })
            .project({ name: 1, username: 1, email: 1, personalization: 1 })
            .toArray()
        : [];
      const userMap = new Map(userDocs.map((doc) => [doc._id.toString(), doc]));

      return grouped.map((item) => {
        const key = item._id ? item._id.toString() : '';
        const label = key ? getUserDisplayName(userMap.get(key)) : 'Unknown';
        return {
          userId: key || null,
          userLabel: label,
          count: item.count
        };
      });
    })();

    const messagesPerDayPromise = messagesCollection
      .aggregate([
        createDateMatchStage('createdAt', startDate, endDate),
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt'
              }
            },
            count: { $sum: 1 }
          }
        },
        { $project: { _id: 0, date: '$_id', count: 1 } },
        { $sort: { date: 1 } }
      ])
      .toArray();

    const usersLoggedPerDayPromise = usersCollection
      .aggregate([
        createDateMatchStage('updatedAt', startDate, endDate),
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$updatedAt'
              }
            },
            count: { $sum: 1 }
          }
        },
        { $project: { _id: 0, date: '$_id', count: 1 } },
        { $sort: { date: 1 } }
      ])
      .toArray();

    const messagesTablePromise = (async () => {
      const tableConditions = [{ sender: 'User' }, { createdAt: { $type: 'date' } }];
      const dateQuery = buildDateRangeQuery('createdAt', startDate, endDate);
      if (dateQuery) {
        tableConditions.push(dateQuery);
      }

      const matchStage = tableConditions.length > 1 ? { $and: tableConditions } : tableConditions[0];
      const totalMatching = await messagesCollection.countDocuments(matchStage);

      const records = await messagesCollection
        .aggregate([
          { $match: matchStage },
          {
            $project: {
              _id: 0,
              messageId: '$messageId',
              conversationId: '$conversationId',
              user: '$user',
              sender: '$sender',
              text: {
                $ifNull: ['$text', '$content']
              },
              createdAt: 1
            }
          },
          { $sort: { createdAt: -1 } },
          { $limit: MESSAGE_TABLE_LIMIT }
        ])
        .toArray();

      const userIdsForTable = uniqueObjectIds(records.map((record) => record.user).filter(Boolean));
      const tableUsers = userIdsForTable.length
        ? await usersCollection
            .find({ _id: { $in: userIdsForTable } })
            .project({ name: 1, username: 1, email: 1, personalization: 1 })
            .toArray()
        : [];
      const tableUserMap = new Map(tableUsers.map((doc) => [doc._id.toString(), doc]));

      const normalizedRecords = records.map((record) => {
        const userId = record.user ? record.user.toString() : null;
        const userName = userId ? getUserDisplayName(tableUserMap.get(userId)) : 'Unknown';

        return {
          messageId: record.messageId ?? null,
          conversationId: record.conversationId ?? null,
          userId,
          userName,
          sender: record.sender ?? null,
          text: record.text ?? null,
          createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : null
        };
      });

      return {
        totalMatching,
        limit: MESSAGE_TABLE_LIMIT,
        records: normalizedRecords
      };
    })();

    const [agentsPerCategory, messagesPerUser, messagesPerDay, usersLoggedPerDay, messagesTable] = await Promise.all([
      agentsPerCategoryPromise,
      messagesPerUserPromise,
      messagesPerDayPromise,
      usersLoggedPerDayPromise,
      messagesTablePromise
    ]);

    res.json({
      totals: {
        users: totalUsers,
        agents: totalAgents,
        messages: totalMessages
      },
      filters: {
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate ? endDate.toISOString() : null
      },
      agentsPerCategory,
      messagesPerUser,
      messagesPerDay,
      usersLoggedPerDay,
      messagesTable
    });
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    res.status(500).json({ error: 'Failed to load dashboard data.', message: error.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`LibreChat data dashboard server listening on port ${port}`);
});
