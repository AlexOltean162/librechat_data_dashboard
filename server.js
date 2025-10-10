import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
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

function coerceToObjectId(value) {
  if (!value) {
    return null;
  }

  if (value instanceof ObjectId) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && ObjectId.isValid(trimmed)) {
      try {
        return new ObjectId(trimmed);
      } catch (error) {
        return null;
      }
    }
  }

  return null;
}

function collectObjectIds(values = []) {
  const seen = new Set();
  const results = [];

  values.forEach((value) => {
    const objectId = coerceToObjectId(value);
    if (!objectId) {
      return;
    }

    const key = objectId.toString();
    if (!seen.has(key)) {
      seen.add(key);
      results.push(objectId);
    }
  });

  return results;
}

function getUserDisplayName(userDoc) {
  if (!userDoc) {
    return 'Unknown';
  }

  const { name, personalization, username, email } = userDoc;

  if (typeof name === 'string' && name.trim()) {
    return name.trim();
  }

  const profile = personalization?.profile || {};
  const candidates = [];

  if (name && typeof name === 'object') {
    if (typeof name.first === 'string' && name.first.trim()) {
      candidates.push(name.first.trim());
    }
    if (typeof name.last === 'string' && name.last.trim()) {
      candidates.push(name.last.trim());
    }
  }

  if (typeof profile.firstName === 'string' && profile.firstName.trim()) {
    candidates.push(profile.firstName.trim());
  }
  if (typeof profile.lastName === 'string' && profile.lastName.trim()) {
    candidates.push(profile.lastName.trim());
  }

  const uniqueParts = [...new Set(candidates.filter(Boolean))];
  if (uniqueParts.length) {
    return uniqueParts.join(' ');
  }

  if (name && typeof name === 'object') {
    const fallback = [name.first, name.last]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)
      .join(' ');
    if (fallback) {
      return fallback;
    }
  }

  if (typeof username === 'string' && username.trim()) {
    return username.trim();
  }

  if (typeof email === 'string' && email.trim()) {
    return email.trim();
  }

  return 'Unknown';
}

function getAgentDisplayName(agentDoc) {
  if (!agentDoc) {
    return 'Unknown';
  }

  if (typeof agentDoc.name === 'string' && agentDoc.name.trim()) {
    return agentDoc.name.trim();
  }

  if (typeof agentDoc.label === 'string' && agentDoc.label.trim()) {
    return agentDoc.label.trim();
  }

  if (Array.isArray(agentDoc.conversation_starters) && agentDoc.conversation_starters.length) {
    const starter = agentDoc.conversation_starters.find((item) => typeof item === 'string' && item.trim());
    if (starter) {
      return starter.trim();
    }
  }

  if (typeof agentDoc.id === 'string' && agentDoc.id.trim()) {
    return agentDoc.id.trim();
  }

  if (agentDoc._id instanceof ObjectId) {
    return agentDoc._id.toString();
  }

  return 'Unknown';
}

function normalizeIdentifier(value) {
  if (value == null) {
    return null;
  }

  if (value instanceof ObjectId) {
    return value.toString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  return String(value);
}

async function buildAgentLookup(collection, identifiers = []) {
  if (!collection || !Array.isArray(identifiers) || !identifiers.length) {
    return new Map();
  }

  const uniqueIds = new Set();
  const objectIds = [];
  const stringIds = [];

  identifiers.forEach((identifier) => {
    const key = normalizeIdentifier(identifier);
    if (!key || uniqueIds.has(key)) {
      return;
    }
    uniqueIds.add(key);

    stringIds.push(key);
    if (ObjectId.isValid(key)) {
      try {
        objectIds.push(new ObjectId(key));
      } catch (error) {
        // Ignore invalid ObjectId construction
      }
    }
  });

  const projections = { name: 1, label: 1, conversation_starters: 1, id: 1 };
  const queries = [];

  if (objectIds.length) {
    queries.push(collection.find({ _id: { $in: objectIds } }).project(projections).toArray());
  }

  if (stringIds.length) {
    queries.push(collection.find({ id: { $in: stringIds } }).project(projections).toArray());
  }

  if (!queries.length) {
    return new Map();
  }

  const results = (await Promise.all(queries)).flat();
  const map = new Map();

  results.forEach((doc) => {
    if (!doc) {
      return;
    }

    if (doc._id instanceof ObjectId) {
      map.set(doc._id.toString(), doc);
    }

    if (typeof doc.id === 'string' && doc.id.trim()) {
      map.set(doc.id.trim(), doc);
    }
  });

  return map;
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
    const conversationsCollection = db.collection('conversations');
    const startDate = parseDateInput(req.query.startDate, 'start');
    const endDate = parseDateInput(req.query.endDate, 'end');

    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ error: 'Invalid date range: startDate must be before endDate.' });
    }

    const [totalUsers, totalAgents, totalMessages] = await Promise.all([
      usersCollection.countDocuments(),
      agentsCollection.countDocuments(),
      messagesCollection.countDocuments(
        startDate || endDate
          ? {
              createdAt: {
                ...(startDate ? { $gte: startDate } : {}),
                ...(endDate ? { $lte: endDate } : {})
              }
            }
          : {}
      )
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

      const userIds = collectObjectIds(grouped.map((item) => item._id));
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

    const conversationsPerAgentPromise = (async () => {
      const grouped = await conversationsCollection
        .aggregate([
          createDateMatchStage('createdAt', startDate, endDate),
          {
            $group: {
              _id: '$agent_id',
              conversations: { $sum: 1 }
            }
          },
          { $sort: { conversations: -1 } }
        ])
        .toArray();

      const agentLookup = await buildAgentLookup(agentsCollection, grouped.map((item) => item._id));

      return grouped.map((item) => {
        const key = normalizeIdentifier(item._id);
        const agentDoc = key ? agentLookup.get(key) : null;
        return {
          agentId: key,
          agentLabel: agentDoc ? getAgentDisplayName(agentDoc) : key || 'Unassigned',
          conversations: item.conversations
        };
      });
    })();

    const messagesPerAgentPromise = (async () => {
      const pipeline = [
        createDateMatchStage('createdAt', startDate, endDate),
        { $match: { conversationId: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: '$conversationId',
            messageCount: { $sum: 1 }
          }
        },
        {
          $lookup: {
            from: 'conversations',
            localField: '_id',
            foreignField: 'conversationId',
            as: 'conversationDoc'
          }
        },
        { $unwind: { path: '$conversationDoc', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: '$conversationDoc.agent_id',
            messages: { $sum: '$messageCount' },
            conversations: {
              $sum: {
                $cond: [{ $ifNull: ['$conversationDoc', false] }, 1, 0]
              }
            }
          }
        },
        {
          $project: {
            messages: 1,
            conversations: 1
          }
        },
        { $sort: { messages: -1 } }
      ];

      const grouped = await messagesCollection.aggregate(pipeline).toArray();
      const agentLookup = await buildAgentLookup(agentsCollection, grouped.map((item) => item._id));

      return grouped.map((item) => {
        const key = normalizeIdentifier(item._id);
        const agentDoc = key ? agentLookup.get(key) : null;
        const conversations = item.conversations || 0;
        const average = conversations > 0 ? item.messages / conversations : item.messages;
        return {
          agentId: key,
          agentLabel: agentDoc ? getAgentDisplayName(agentDoc) : key || 'Unassigned',
          messages: item.messages,
          conversations,
          averageMessagesPerConversation: Number(average.toFixed(2))
        };
      });
    })();

    const messagesByEndpointPromise = messagesCollection
      .aggregate([
        createDateMatchStage('createdAt', startDate, endDate),
        {
          $group: {
            _id: {
              $cond: [{ $ifNull: ['$endpoint', false] }, '$endpoint', 'Unknown']
            },
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            endpoint: '$_id',
            count: 1
          }
        },
        { $sort: { count: -1 } }
      ])
      .toArray();

    const activeUsersPerDayPromise = messagesCollection
      .aggregate([
        createDateMatchStage('createdAt', startDate, endDate),
        { $match: { user: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: {
              date: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$createdAt'
                }
              },
              user: '$user'
            }
          }
        },
        {
          $group: {
            _id: '$_id.date',
            count: { $sum: 1 }
          }
        },
        { $project: { _id: 0, date: '$_id', count: 1 } },
        { $sort: { date: 1 } }
      ])
      .toArray();

    const newUsersPerDayPromise = usersCollection
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

    const [
      agentsPerCategory,
      messagesPerUser,
      messagesPerDay,
      usersLoggedPerDay,
      conversationsPerAgent,
      messagesPerAgent,
      messagesByEndpoint,
      activeUsersPerDay,
      newUsersPerDay
    ] = await Promise.all([
      agentsPerCategoryPromise,
      messagesPerUserPromise,
      messagesPerDayPromise,
      usersLoggedPerDayPromise,
      conversationsPerAgentPromise,
      messagesPerAgentPromise,
      messagesByEndpointPromise,
      activeUsersPerDayPromise,
      newUsersPerDayPromise
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
      conversationsPerAgent,
      messagesPerAgent,
      messagesByEndpoint,
      activeUsersPerDay,
      newUsersPerDay
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
