// Q Wahh wahh! this code is terrible!!

// A Contribute and fix it yourself, otherwise shut up

const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const fetch = require('node-fetch');
const moment = require('moment');
require('dotenv').config();

const CONFIG = {
  COOLDOWN_MS: 1500,
  API_TIMEOUT: 12000,
  FRIENDS_PER_PAGE: 3,
  CACHE_TTL: 300000,
  EISERNER_GROUP_ID: 32441040,
  NOTABLE_GROUP_IDS: [
    34039115, 34039523, 34039531, 34039535, 33867332, 33498997, 35662881, 32458845, 33649003,
    33261877, 33081269, 32720033, 32458556, 32458662, 32471205, 32720151, 33505741, 34960102,
    32441040, 35403428, 34539395, 34172303, 34039566, 34039557, 34364892, 34311324, 33867480,
    10813440, 33867409, 34608573, 33507667, 34929316, 33892482, 33921951, 33155522, 34124729,
    34341530, 33540453, 13832172, 33828775, 32808348, 33532566, 33532589, 3561847, 33643342,
    15629059, 33547423, 33547450, 34659276, 33511450, 6324631, 12407506, 11660292, 33627095,
    33595204, 33515290, 12407541, 11660112, 35671070, 35236182, 12407566, 34070794, 10310326,
    8361866, 10798209, 33466510, 32578602, 33429030, 33635716, 12407592, 10408465, 34286793, 
    35467805, 35671345, 35674468, 34661295, 35607878, 12407696, 33488022, 33423261, 34619163, 
    12363529, 34432453, 33798759, 33481191, 33462805, 33567307, 34070816, 12363524, 33559226,
    12407643, 12363487, 12363467, 12363512, 33512933, 35138894, 34631399, 33445599, 35347614,
    33220222, 33703892, 33148684, 32598020, 34307607, 34306309, 32475802, 33738848, 32471264,
    34885770, 6594744, 35071703, 13541620, 34043205, 34394256, 8305437, 34504704, 13695263,
    34710354, 33396547
  ],
  MAX_FRIENDS_TO_PROCESS: 50,
  FRIEND_PROCESSING_TIMEOUT: 45000,
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY: 1000,
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.cooldowns = new Map();

class BotState {
  constructor() {
    this.commandUsage = 0;
    this.startTime = Date.now();
    this.cache = new Map();
  }

  getCachedItem(key) {
    if (this.cache.has(key)) {
      const cachedItem = this.cache.get(key);
      if (Date.now() - cachedItem.timestamp < CONFIG.CACHE_TTL) {
        return cachedItem.data;
      }
    }
    return null;
  }

  setCachedItem(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }
}

const state = new BotState();

const createApiClient = (baseURL) => axios.create({
  baseURL,
  timeout: CONFIG.API_TIMEOUT,
  headers: { 'User-Agent': 'Discord-Bot/1.0.0' }
});

const robloxUsersApi = createApiClient('https://users.roblox.com/v1');
const robloxGroupsApi = createApiClient('https://groups.roblox.com/v1');
const robloxFriendsApi = createApiClient('https://friends.roblox.com/v1');
const robloxBadgesApi = createApiClient('https://badges.roblox.com/v1');
const robloxAvatarApi = createApiClient('https://avatar.roblox.com/v1');

const COLORS = {
  RESET: '\x1b[0m',
  BLUE: '\x1b[34m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m'
};

const Logger = {
  log(message) {
    const timestamp = new Date().toISOString();
    console.log(`${COLORS.BLUE}[${timestamp}] ${message}${COLORS.RESET}`);
  },
  
  warn(message) {
    const timestamp = new Date().toISOString();
    console.warn(`${COLORS.YELLOW}[${timestamp}] WARNING: ${message}${COLORS.RESET}`);
  },
  
  error(message) {
    const timestamp = new Date().toISOString();
    console.error(`${COLORS.RED}[${timestamp}] ERROR: ${message}${COLORS.RESET}`);
  }
};

async function retryableRequest(requestFn, maxRetries = CONFIG.RETRY_ATTEMPTS) {
  let lastError;
  let backoffDelay = CONFIG.RETRY_DELAY;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      
      if (error.response && error.response.status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after'] || '2', 10);
        backoffDelay = (retryAfter * 1000) || (backoffDelay * 2);
        Logger.warn(`Rate limited, waiting ${backoffDelay}ms before retry`);
      } else {
        backoffDelay = attempt === 0 ? backoffDelay : backoffDelay * 2;
      }
      
      if (attempt < maxRetries) {
        Logger.error(`Request failed (${error.message}), retrying in ${backoffDelay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }
  
  throw lastError;
}

const RobloxService = {
  async getUserInfo(username) {
    const cacheKey = `user:${username}`;
    const cachedData = state.getCachedItem(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    try {
      const { data: { data: userData } } = await retryableRequest(() => 
        robloxUsersApi.post('/usernames/users', { 
          usernames: [username], 
          excludeBannedUsers: true 
        })
      );

      if (!userData.length) throw new Error(`Couldn't find "${username}"`);

      const userId = userData[0].id;
      
      const { data: userDetails } = await retryableRequest(() => 
        robloxUsersApi.get(`/users/${userId}`)
      );
      
      const [thumbnailRes, presenceRes] = await Promise.all([
        retryableRequest(() => axios.get(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=250x250&format=Png`)),
        retryableRequest(() => axios.post(`https://presence.roblox.com/v1/presence/users`, { userIds: [userId] }))
      ]);

      const presence = presenceRes.data.userPresences[0];
      
      let statusColor, statusEmoji, statusText;

      switch (presence.userPresenceType) {
        case 0:
          statusColor = 0xff342c;
          statusEmoji = '🔴';
          statusText = 'Offline';
          break;
        case 1:
          statusColor = 0x1078a4;
          statusEmoji = '🔵';
          statusText = 'Website';
          break;
        case 2:
          statusColor = 0x08d470;
          statusEmoji = '🟢';
          statusText = `Online - ${presence.lastLocation || 'In Game'}`;
          break;
        case 3:
          statusColor = 0xff6424;
          statusEmoji = '🟠';
          statusText = 'Studio';
          break;
        default:
          statusColor = 0xff342c;
          statusEmoji = '🔴';
          statusText = 'Unknown';
      }

      const result = {
        userId,
        username: userData[0].name,
        displayName: userData[0].displayName,
        description: userDetails.description,
        created: userDetails.created,
        avatarUrl: thumbnailRes.data.data[0]?.imageUrl,
        presenceType: presence.userPresenceType,
        lastLocation: statusText,
        statusColor,
        statusEmoji,
        profileUrl: `https://www.roblox.com/users/${userId}/profile`
      };

      state.setCachedItem(cacheKey, result);
      return result;
    } catch (error) {
      Logger.warn(`Couldn't fetch information for '${username}'. (${error.message})`);
      throw new Error(`Failed to fetch user information: ${error.message}`);
    }
  },

  async getUserInfoById(userId) {
    const cacheKey = `userId:${userId}`;
    const cachedData = state.getCachedItem(cacheKey);
    if (cachedData) return cachedData;

    try {
      const { data: userDetails } = await retryableRequest(() => 
        robloxUsersApi.get(`/users/${userId}`)
      );
      
      const result = {
        userId,
        username: userDetails.name,
        displayName: userDetails.displayName,
        description: userDetails.description,
        created: userDetails.created,
      };
      
      state.setCachedItem(cacheKey, result);
      return result;
    } catch (error) {
      throw new Error(`Failed to fetch user info by ID: ${error.message}`);
    }
  },

  async getUserGroups(userId) {
    const cacheKey = `userGroups:${userId}`;
    const cachedData = state.getCachedItem(cacheKey);
    if (cachedData) return cachedData;

    try {
      const { data } = await retryableRequest(() => 
        robloxGroupsApi.get(`/users/${userId}/groups/roles`)
      );
      
      state.setCachedItem(cacheKey, data.data);
      return data.data;
    } catch (error) {
      Logger.error(`Couldn't fetch groups for ${userId}: ${error.message}`);
      throw new Error(`Failed to fetch user groups: ${error.message}`);
    }
  },

  async getUserRankInGroup(userId, groupId) {
    const groups = await this.getUserGroups(userId);
    const group = groups.find(g => g.group.id === groupId);
    return group ? group.role.name : null;
  },

  async getUserGroupMemberships(userId, groupIds) {
    try {
      const groups = await this.getUserGroups(userId);
      
      if (groups.length > 100) {
        Logger.warn(`${userId} has ${groups.length} groups - limiting to 100!`);
        const limitedGroups = groups.slice(0, 100);
        
        return groupIds
          .filter(id => limitedGroups.some(g => g.group.id === id))
          .map(id => {
            const group = limitedGroups.find(g => g.group.id === id);
            return {
              id,
              name: group.group.name,
              role: group.role.name
            };
          });
      }
      
      return groupIds
        .filter(id => groups.some(g => g.group.id === id))
        .map(id => {
          const group = groups.find(g => g.group.id === id);
          return {
            id,
            name: group.group.name,
            role: group.role.name
          };
        });
    } catch (error) {
      Logger.warn(`Couldn't fetch groups for ${userId}: ${error.message}`);
      return [];
    }
  },

  async getUserFriends(userId) {
    const cacheKey = `friends:${userId}`;
    const cachedData = state.getCachedItem(cacheKey);
    if (cachedData) return cachedData;

    try {
      const { data } = await retryableRequest(() => 
        robloxFriendsApi.get(`/users/${userId}/friends`)
      );
      
      const friendCount = data.data.length;
      let maxFriendsToProcess = CONFIG.MAX_FRIENDS_TO_PROCESS;
      
      if (friendCount > 200) {
        maxFriendsToProcess = Math.min(30, maxFriendsToProcess);
        Logger.warn(`${userId} has ${friendCount} friends - limiting to ${maxFriendsToProcess}`);
      } else if (friendCount > 100) {
        maxFriendsToProcess = Math.min(40, maxFriendsToProcess);
      }
      
      const friends = data.data.slice(0, maxFriendsToProcess);
      
      const timeoutDuration = friendCount > 150 ? 
        CONFIG.FRIEND_PROCESSING_TIMEOUT / 2 : 
        CONFIG.FRIEND_PROCESSING_TIMEOUT;
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Friend processing timeout - profile too large')), timeoutDuration);
      });
      
      const processFriendsPromise = (async () => {
        const batchSize = 3;
        const result = [];
        
        for (let i = 0; i < friends.length; i += batchSize) {
          const batch = friends.slice(i, i + batchSize);
          const batchPromises = batch.map(async (friend) => {
            try {
              const groupsToCheck = friendCount > 200 ? 
                CONFIG.NOTABLE_GROUP_IDS.slice(0, 20) : 
                CONFIG.NOTABLE_GROUP_IDS;
                
              const groups = await this.getUserGroupMemberships(friend.id, groupsToCheck);
              if (groups.length) {
                return { 
                  id: friend.id, 
                  username: friend.name, 
                  displayName: friend.displayName, 
                  isOnline: friend.isOnline, 
                  groups 
                };
              }
              return null;
            } catch (error) {
              Logger.error(`Couldn't process ${friend.id}: ${error.message}`);
              return null;
            }
          });
          
          try {
            const batchResults = await Promise.all(batchPromises);
            result.push(...batchResults.filter(Boolean));
            
            if (result.length >= 10 && friendCount > 150 && i >= friends.length / 2) {
              Logger.warn(`Got ${result.length} results - returning early for large profile`);
              break;
            }
          } catch (error) {
            Logger.error(`Couldn't process batch: ${error.message}`);
          }
        }
        
        return result;
      })();
      
      let result;
      try {
        result = await Promise.race([processFriendsPromise, timeoutPromise]);
      } catch (error) {
        Logger.warn(`Friend processing warning: ${error.message}`);
        result = await processFriendsPromise.catch(e => {
          Logger.error(`Error retrieving partial results: ${e.message}`);
          return [];
        });
      }
      
      state.setCachedItem(cacheKey, result);
      return result;
    } catch (error) {
      Logger.error(`Error fetching friends for user ${userId}: ${error.message}`);
      return [];
    }
  },

  async getFollowerCount(userId) {
    const cacheKey = `followers:${userId}`;
    const cachedData = state.getCachedItem(cacheKey);
    if (cachedData) return cachedData;

    try {
      const { data } = await retryableRequest(() =>
        robloxFriendsApi.get(`/users/${userId}/followers/count`)
      );
      state.setCachedItem(cacheKey, data.count);
      return data.count;
    } catch (error) {
      throw new Error(`Error fetching follower count: ${error.message}`);
    }
  },

  async getFriendCount(userId) {
    const cacheKey = `friendsCount:${userId}`;
    const cachedData = state.getCachedItem(cacheKey);
    if (cachedData) return cachedData;

    try {
      const { data } = await retryableRequest(() =>
        robloxFriendsApi.get(`/users/${userId}/friends/count`)
      );
      state.setCachedItem(cacheKey, data.count);
      return data.count;
    } catch (error) {
      throw new Error(`Error fetching friend count: ${error.message}`);
    }
  },

  async getAllBadges(userId) {
    const cacheKey = `badges:${userId}`;
    const cachedData = state.getCachedItem(cacheKey);
    if (cachedData) return cachedData;

    let badges = [];
    let cursor = null;
    try {
      do {
        const { data } = await retryableRequest(() =>
          robloxBadgesApi.get(`/users/${userId}/badges?limit=100&cursor=${cursor || ''}&sortOrder=Asc`)
        );
        badges = badges.concat(data.data);
        cursor = data.nextPageCursor;
      } while (cursor);
      state.setCachedItem(cacheKey, badges);
      return badges;
    } catch (error) {
      throw new Error(`Error fetching badges: ${error.message}`);
    }
  },

  async getAvatarInfo(userId) {
    const cacheKey = `avatar:${userId}`;
    const cachedData = state.getCachedItem(cacheKey);
    if (cachedData) return cachedData;

    try {
      const { data } = await retryableRequest(() =>
        robloxAvatarApi.get(`/users/${userId}/avatar`)
      );
      state.setCachedItem(cacheKey, data);
      return data;
    } catch (error) {
      throw new Error(`Error fetching avatar info: ${error.message}`);
    }
  },

  async getUserUniverses(userId) {
    const cacheKey = `universes:${userId}`;
    const cachedData = state.getCachedItem(cacheKey);
    if (cachedData) return cachedData;

    try {
      const { data } = await retryableRequest(() =>
        axios.get(`https://games.roblox.com/v2/users/${userId}/games?accessFilter=2&limit=50`)
      );
      const universes = data.data;
      state.setCachedItem(cacheKey, universes);
      return universes;
    } catch (error) {
      Logger.error(`Error fetching universes for user ${userId}: ${error.message}`);
      throw new Error(`Failed to fetch user universes: ${error.message}`);
    }
  },

  async getUniverseDetails(universeId) {
    const cacheKey = `universe:${universeId}`;
    const cachedData = state.getCachedItem(cacheKey);
    if (cachedData) return cachedData;

    try {
      const { data } = await retryableRequest(() =>
        axios.get(`https://games.roblox.com/v1/games?universeIds=${universeId}`)
      );
      const universeDetails = data.data[0];
      state.setCachedItem(cacheKey, universeDetails);
      return universeDetails;
    } catch (error) {
      Logger.error(`Error fetching universe details for ${universeId}: ${error.message}`);
      throw new Error(`Failed to fetch universe details: ${error.message}`);
    }
  },

  async getUserCreatedAssets(userId) {
    const cacheKey = `createdAssets:${userId}`;
    const cachedData = state.getCachedItem(cacheKey);
    if (cachedData) return cachedData;

    try {
      const { data } = await retryableRequest(() =>
        axios.get(`https://catalog.roblox.com/v1/users/${userId}/assets?assetTypes=8,2,11,12&limit=1`)
      );
      const assets = data.data;
      state.setCachedItem(cacheKey, assets);
      return assets;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        const noAssets = [];
        state.setCachedItem(cacheKey, noAssets);
        return noAssets;
      }
      Logger.error(`Error fetching created assets for user ${userId}: ${error.message}`);
      throw new Error(`Failed to fetch created assets: ${error.message}`);
    }
  }
};

const AltDetectorService = {
  async detectAlt(userId) {
    try {
      const [
        followerCount,
        friendCount,
        badges,
        avatarInfo,
        userInfo,
        universes,
        createdAssets,
        groups
      ] = await Promise.all([
        RobloxService.getFollowerCount(userId),
        RobloxService.getFriendCount(userId),
        RobloxService.getAllBadges(userId),
        RobloxService.getAvatarInfo(userId),
        RobloxService.getUserInfoById(userId),
        RobloxService.getUserUniverses(userId),
        RobloxService.getUserCreatedAssets(userId),
        RobloxService.getUserGroups(userId)
      ]);

      const creationDate = new Date(userInfo.created);
      const accountAgeDays = Math.floor((Date.now() - creationDate) / (1000 * 60 * 60 * 24));
      const description = userInfo.description || '';

      const badgeCount = badges.length;
      const awardedDates = badges.map(badge => ({
        date: badge.created,
        name: badge.name
      })).sort((a, b) => new Date(a.date) - new Date(b.date));

      let suspiciousBadgeAcquisitions = 0;
      for (let i = 2; i < awardedDates.length; i++) {
        if ((new Date(awardedDates[i].date) - new Date(awardedDates[i - 2].date)) / (1000 * 60) < 5) {
          suspiciousBadgeAcquisitions++;
        }
      }

      const accessories = avatarInfo.assets.filter(asset => asset.assetType.id >= 41);
      const hasAccessories = accessories.length > 0;

      const gameCount = universes.length;

      const visitCounts = await Promise.all(
        universes.slice(0, 5).map(async (universe) => {
          const universeDetails = await RobloxService.getUniverseDetails(universe.id);
          return universeDetails.visits || 0;
        })
      );
      const totalVisits = visitCounts.reduce((sum, visits) => sum + visits, 0);

      const hasCreatedAssets = createdAssets.length > 0;

      const groupCount = groups.length;
      const ownsGroups = groups.some(group => group.role.rank === 255);

      let ageScore = 0;
      if (accountAgeDays < 7) ageScore = 0;
      else if (accountAgeDays < 30) ageScore = 1;
      else if (accountAgeDays < 90) ageScore = 2;
      else if (accountAgeDays < 180) ageScore = 3;
      else ageScore = 4;

      let followerScore = 0;
      if (followerCount <= 10) followerScore = 0;
      else if (followerCount <= 50) followerScore = 1;
      else if (followerCount <= 100) followerScore = 2;
      else if (followerCount <= 500) followerScore = 3;
      else followerScore = 4;

      let friendScore = 0;
      if (friendCount <= 10) friendScore = 1;
      else if (friendCount <= 50) friendScore = 2;
      else if (friendCount <= 100) friendScore = 3;
      else friendScore = 4;

      let badgeScore = 0;
      if (badgeCount <= 5) badgeScore = 0;
      else if (badgeCount <= 20) badgeScore = 1;
      else if (badgeCount <= 50) badgeScore = 2;
      else if (badgeCount <= 100) badgeScore = 3;
      else badgeScore = 4;

      let descriptionScore = description.trim() !== '' ? 1 : 0;

      let accessoriesScore = hasAccessories ? 1 : 0;

      let visitScore = 0;
      if (totalVisits == 0) visitScore = 0;
      else if (totalVisits <= 100) visitScore = 1;
      else if (totalVisits <= 1000) visitScore = 2;
      else if (totalVisits <= 10000) visitScore = 3;
      else visitScore = 4;

      let gameScore = 0;
      if (gameCount == 0) gameScore = 0;
      else if (gameCount == 1) gameScore = 1;
      else if (gameCount <= 3) gameScore = 2;
      else if (gameCount <= 5) gameScore = 3;
      else gameScore = 4;

      let createdAssetsScore = hasCreatedAssets ? 2 : 0;

      let groupScore = 0;
      if (groupCount == 0) groupScore = 0;
      else if (groupCount <= 5) groupScore = 1;
      else if (groupCount <= 10) groupScore = 2;
      else if (groupCount <= 20) groupScore = 3;
      else groupScore = 4;

      let ownsGroupsScore = ownsGroups ? 3 : 0;

      let score = ageScore + followerScore + friendScore + badgeScore + descriptionScore + accessoriesScore + visitScore + gameScore + createdAssetsScore + groupScore + ownsGroupsScore;

      if (suspiciousBadgeAcquisitions > 0) score -= 2;

      const judgment = score < 10 ? '🔴 This account seems to be an alt.' :
                       score <= 20 ? '🟡 This account seems suspicious.' :
                       '🟢 This account seems clear.';

      return {
        username: userInfo.name,
        accountAgeDays,
        followerCount,
        friendCount,
        badgeCount,
        suspiciousBadgeAcquisitions,
        hasDescription: description.trim() !== '',
        hasAccessories,
        gameCount,
        totalVisits,
        hasCreatedAssets,
        groupCount,
        ownsGroups,
        ageScore,
        followerScore,
        friendScore,
        badgeScore,
        descriptionScore,
        accessoriesScore,
        visitScore,
        gameScore,
        createdAssetsScore,
        groupScore,
        ownsGroupsScore,
        totalScore: score,
        judgment,
        badges: awardedDates
      };
    } catch (error) {
      Logger.error(`Failed to check an alt for ${userId}: ${error.message}`);
      throw new Error(`❌ Faced an exception: ${error.message}`);
    }
  },

  async createBadgeChart(badges, username) {
    if (!badges || !Array.isArray(badges) || badges.length === 0) {
      Logger.warn(`No badges provided or invalid badges array for ${username}`);
      return null;
    }

    const MAX_MONTHS = 48;
    const badgesByMonth = {};
    badges.forEach((badge, index) => {
      const date = new Date(badge.date);
      if (isNaN(date.getTime())) {
        Logger.warn(`Invalid date for badge at index ${index}: ${JSON.stringify(badge)}`);
        return;
      }
      const monthKey = date.toISOString().slice(0, 7);
      badgesByMonth[monthKey] = (badgesByMonth[monthKey] || 0) + 1;
    });

    const allLabels = Object.keys(badgesByMonth).sort();
    let labels = allLabels.slice(-MAX_MONTHS);
    let truncated = false;

    if (allLabels.length > MAX_MONTHS) {
      truncated = true;
      const olderMonths = allLabels.slice(0, allLabels.length - MAX_MONTHS);
      const olderCount = olderMonths.reduce((sum, month) => sum + badgesByMonth[month], 0);
      labels = ['Older', ...labels];
      badgesByMonth['Older'] = olderCount;
    }

    if (!labels.length) {
      Logger.warn(`No valid dates found after processing badges for ${username}`);
      return null;
    }

    const data = labels.map(month => badgesByMonth[month]);

    const chartConfig = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Badges',
          data: data,
          backgroundColor: 'rgba(192,4,60,0.8)',
          borderColor:'rgba(67,3,22,0.8)'
        }]
      },
      options: {
        plugins: {
          title: { display: true, text: `Badge Timeline for ${username}` },
          legend: { display: false }
        },
        scales: {
          x: { title: { display: true, text: 'Month' }, ticks: { maxRotation: 45 } },
          y: { title: { display: true, text: 'Count' }, beginAtZero: true }
        }
      }
    };

    try {
      const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=800&h=400`;
      if (chartUrl.length > 2048) {
        Logger.error(`Chart URL too long (${chartUrl.length} chars) for ${username}`);
        return null;
      }
      Logger.log(`Generated chart for ${username}: ${chartUrl.length} chars`);
      return chartUrl;
    } catch (error) {
      Logger.error(`Failed to generate chart for ${username}: ${error.message}`);
      return null;
    }
  },

  generateExplanation(altResult) {
    const {
      judgment,
      username,
      accountAgeDays,
      followerCount,
      friendCount,
      badgeCount,
      suspiciousBadgeAcquisitions,
      hasDescription,
      hasAccessories,
      gameCount,
      totalVisits,
      hasCreatedAssets,
      groupCount,
      ownsGroups
    } = altResult;
  
    function describeAge(days) {
      if (days < 30) return 'very new';
      if (days < 90) return 'somewhat new';
      if (days < 180) return 'fairly established';
      return 'well-established';
    }
  
    function describeCount(value, type) {
      const thresholds = {
        followers: { low: 10, medium: 50, high: 100 },
        friends: { low: 10, medium: 50, high: 100 },
        badges: { low: 5, medium: 20, high: 50 },
        games: { low: 1, medium: 3, high: 5 },
        visits: { low: 100, medium: 1000, high: 10000 },
        groups: { low: 5, medium: 10, high: 20 }
      }[type];
  
      if (value === 0) return 'no';
      if (value < thresholds.low) return 'very few';
      if (value < thresholds.medium) return 'some';
      if (value < thresholds.high) return 'a decent number of';
      return 'many';
    }
  
    function describeSocialActivity(followers, friends) {
      const followerDesc = describeCount(followers, 'followers');
      const friendDesc = describeCount(friends, 'friends');
      if (followers > 10 * friends || friends > 10 * followers) {
        return 'an unusual social ratio';
      } else if (followerDesc === 'very few' && friendDesc === 'very few') {
        return 'limited social interaction';
      } else if (followerDesc === 'many' || friendDesc === 'many') {
        return 'an active social presence';
      } else {
        return 'moderate social engagement';
      }
    }
  
    function describePersonalization(hasDescription, hasAccessories) {
      if (hasDescription && hasAccessories) {
        return 'is well-personalized with a description and avatar customization';
      } else if (hasDescription || hasAccessories) {
        return 'has some personalization';
      } else {
        return 'lacks personalization';
      }
    }
  
    function describeAssets(hasCreatedAssets) {
      return hasCreatedAssets ? 'has created assets' : 'has no created assets';
    }
  
    function describeGames(gameCount, totalVisits) {
      const gameDesc = describeCount(gameCount, 'games');
      const visitDesc = describeCount(totalVisits, 'visits');
      if (gameCount === 0) {
        return 'has no games';
      } else {
        return `has ${gameDesc} games with ${visitDesc} total visits`;
      }
    }
  
    function describeGroups(groupCount, ownsGroups) {
      const groupDesc = describeCount(groupCount, 'groups');
      let desc = `is in ${groupDesc} groups`;
      if (ownsGroups) {
        desc += ' and owns some';
      }
      return desc;
    }
  
    const ageDescription = describeAge(accountAgeDays);
    const socialActivityDescription = describeSocialActivity(followerCount, friendCount);
    const personalizationDescription = describePersonalization(hasDescription, hasAccessories);
    const assetDescription = describeAssets(hasCreatedAssets);
    const gamesDescription = describeGames(gameCount, totalVisits);
    const groupsDescription = describeGroups(groupCount, ownsGroups);
  
    let explanation = `The account **${username}** is ${ageDescription}, having been created ${accountAgeDays} days ago. `;
  
    explanation += `Socially, it has ${describeCount(followerCount, 'followers')} followers (${followerCount}) and ${describeCount(friendCount, 'friends')} friends (${friendCount}), indicating ${socialActivityDescription}. `;
  
    explanation += `In terms of engagement, it has ${describeCount(badgeCount, 'badges')} badges (${badgeCount}), and the profile ${personalizationDescription}. `;
  
    explanation += `Regarding content creation, it ${gamesDescription}, and ${assetDescription}. `;
  
    explanation += `Community-wise, it ${groupsDescription}. `;
  
    if (judgment.includes('alt')) {
      explanation += `\n\nThese factors suggest that this is likely an alt account due to its recent creation and minimal activity across the platform. The lack of social connections, engagement, and personalization are typical signs of an alt.`;
      if (suspiciousBadgeAcquisitions > 0) {
        explanation += ` Additionally, there are ${suspiciousBadgeAcquisitions} suspicious badge acquisitions, which might indicate attempts to make the account appear more legitimate.`;
      }
    } else if (judgment.includes('clear')) {
      explanation += `\n\nThese indicators point to a legitimate main account with a history of engagement and activity on Roblox. The account shows signs of investment in personalization, content creation, and community involvement.`;
    } else {
      explanation += `\n\nThere are some inconsistencies in the account's activity that raise suspicions. `;
      if (suspiciousBadgeAcquisitions > 0) {
        explanation += `For instance, there are ${suspiciousBadgeAcquisitions} suspicious badge acquisitions, suggesting possible badge farming. `;
      }
      if (accountAgeDays > 90 && (followerCount < 10 || friendCount < 10)) {
        explanation += `Despite being ${ageDescription}, the account has very few social connections, which is unusual. `;
      }
      if (gameCount > 0 && totalVisits < 100) {
        explanation += `The games have very low visit counts, which might indicate they are not actively maintained. `;
      }
      if (!hasDescription && !hasAccessories) {
        explanation += `The lack of profile personalization is also a red flag. `;
      }
      explanation += `Overall, while the account isn't clearly an alt, these factors warrant caution.`;
    }
  
    return explanation;
  }
};

const EmbedHelper = {
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  },

  createDynamicEmbed(robloxInfo, rankInEiserner, affiliatedGroups, friends, page = 1) {
    const embed = new EmbedBuilder()
      .setTitle(`🔎 ${robloxInfo.displayName} (@${robloxInfo.username})`)
      .setURL(robloxInfo.profileUrl)
      .setColor(robloxInfo.statusColor)
      .setThumbnail(robloxInfo.avatarUrl || null)
      .addFields(
        { 
          name: '🌐 Status', 
          value: `${robloxInfo.statusEmoji} ${robloxInfo.lastLocation}`, 
          inline: true 
        }
      );

    const evStatus = rankInEiserner 
      ? `✅ EV Member • **${rankInEiserner}**` 
      : '❌ Not an EV Member';
    
    embed.addFields({ name: '🇩🇪 Eiserner Vorhang', value: evStatus, inline: true });

    if (affiliatedGroups.length) {
      const groupsByRole = {};
      affiliatedGroups.forEach(g => {
        if (!groupsByRole[g.role]) {
          groupsByRole[g.role] = [];
        }
        groupsByRole[g.role].push(g.name);
      });

      let affiliationsText = '';
      const roleEntries = Object.entries(groupsByRole);
      
      if (roleEntries.length > 5) {
        affiliationsText = roleEntries.slice(0, 4)
          .map(([role, groups]) => {
            if (groups.length > 3) {
              return `**${role}**: ${groups.slice(0, 3).join(', ')} +${groups.length - 3} more`;
            }
            return `**${role}**: ${groups.join(', ')}`;
          })
          .join('\n');
          
        const remainingRoles = roleEntries.length - 4;
        affiliationsText += `\n\n*+${remainingRoles} more roles (${affiliatedGroups.length - roleEntries.slice(0, 4).flatMap(([_, groups]) => groups).length} groups)*`;
      } else {
        affiliationsText = roleEntries
          .map(([role, groups]) => {
            if (groups.length > 5) {
              return `**${role}**: ${groups.slice(0, 5).join(', ')} +${groups.length - 5} more`;
            }
            return `**${role}**: ${groups.join(', ')}`;
          })
          .join('\n');
      }

      embed.addFields({ 
        name: `📋 Other Affiliations (${affiliatedGroups.length})`, 
        value: this.smartTruncate(affiliationsText, 1024) || 'No other notable affiliations', 
        inline: false 
      });
    } else if (!rankInEiserner) {
      embed.addFields({ 
        name: '📋 Other Affiliations', 
        value: 'No Notable Affiliations', 
        inline: false 
      });
    }

    embed.setFooter({ 
      text: '⚠️ AI-Generated Information • May not be fully accurate!' 
    });
    
    const totalPages = Math.ceil(friends.length / CONFIG.FRIENDS_PER_PAGE) || 1;
    const startIdx = (page - 1) * CONFIG.FRIENDS_PER_PAGE;
    const paginatedFriends = friends.slice(startIdx, startIdx + CONFIG.FRIENDS_PER_PAGE);

    if (paginatedFriends.length) {
      let friendsText = '';
      
      for (const f of paginatedFriends) {
        const statusEmoji = f.isOnline ? '🟢' : '🔴';
        
        let groupInfo = '';
        if (f.groups.length > 3) {
          groupInfo = f.groups.slice(0, 3).map(g => `• ${g.name} (${g.role})`).join('\n');
          groupInfo += `\n• *+${f.groups.length - 3} More Groups*`;
        } else {
          groupInfo = f.groups.map(g => `• ${g.name} (${g.role})`).join('\n');
        }
        
        const friendText = `**${f.displayName}** (@${f.username}) ${statusEmoji}\n${groupInfo}`;
        
        if ((friendsText + '\n\n' + friendText).length > 1000) {
          if (friendsText === '') {
            friendsText = this.smartTruncate(friendText, 1000);
          } else {
            friendsText += '\n\n*Some of the less important details have been hidden due to limitations.';
          }
          break;
        }
        
        friendsText += (friendsText ? '\n\n' : '') + friendText;
      }
      
      embed.addFields({ 
        name: `👥 Notable Friends (${friends.length} Total)`, 
        value: friendsText || 'No other notable friends', 
        inline: false 
      });
      
      if (totalPages > 1) {
        embed.addFields({ 
          name: 'Page Navigation', 
          value: `Page ${page}/${totalPages}`, 
          inline: true 
        });
      }
    } else {
      embed.addFields({ 
        name: '👥 Notable Friends', 
        value: 'No Notable Friends', 
        inline: false 
      });
    }

    embed.setTimestamp();
    
    return { embed, totalPages };
  },
  
  smartTruncate(text, maxLength = 1024) {
    if (text.length <= maxLength) return text;
    
    const sections = text.split('\n\n');
    
    if (sections.length === 1) {
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
      
      let result = '';
      for (const sentence of sentences) {
        if ((result + sentence).length <= maxLength - 3) {
          result += sentence;
        } else {
          break;
        }
      }
      
      return result + '...';
    }
    
    let result = '';
    let currentLength = 0;
    
    for (const section of sections) {
      if (currentLength + section.length + 2 <= maxLength) {
        result += (result ? '\n\n' : '') + section;
        currentLength += section.length + 2;
      } else {
        const remainingSpace = maxLength - currentLength - 5;
        if (remainingSpace > 30) {
          result += '\n\n' + section.substring(0, remainingSpace) + '...';
        } else {
          result += '\n\n...';
        }
        break;
      }
    }
    
    return result;
  }
};

function formatDescription(description) {
  if (!description) return null;
  if (description.length > 250) {
    return description.substring(0, 250) + '...';
  }
  return description;
}

function stripIndent(strings, ...values) {
  const result = strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '');
  const lines = result.split('\n');
  const indentSize = lines[1] ? lines[1].match(/^\s*/)[0].length : 0;
  return lines.map(line => line.slice(indentSize)).join('\n').trim();
}

const commands = [
  new SlashCommandBuilder()
    .setName('check')
    .setDescription("Retrieve a fast and automated profiling of any user.")
    .addStringOption(o => o.setName('username').setDescription('Roblox Username').setRequired(true)),
  new SlashCommandBuilder()
    .setName('game')
    .setDescription('Retrieve a fast and automated profiling of any game.')
    .addStringOption(option => 
      option.setName('id')
        .setDescription('Roblox Game ID')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('id_type')
        .setDescription('Roblox games have two types of IDs, which one are you using?')
        .setRequired(false)
        .addChoices(
          { name: 'Universe', value: 'universe' },
          { name: 'Place (default)', value: 'place' }
        )),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Check out what I offer!'),
  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Invite me to your server!')
];

const ButtonHelper = {
  createButtons(username, totalPages = 1, currentPage = 1) {
    const row = new ActionRowBuilder();
    
    if (totalPages > 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`prev_${username}_${currentPage}`)
          .setLabel('◀️ Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === 1),
        new ButtonBuilder()
          .setCustomId(`next_${username}_${currentPage}`)
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === totalPages)
      );
    }
    
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`altcheck_${username}`)
        .setLabel('Alt Check 👺')
        .setStyle(ButtonStyle.Secondary)
    );
    
    return row;
  },

  createAltButtons(username) {
    return new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`badgechart_${username}`)
          .setLabel('Make a Chart 📊')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`explain_alt_${username}`)
          .setLabel('Give me an Explanation 🧠')
          .setStyle(ButtonStyle.Secondary)
      );
  }
};

const CommandHandler = {
  async checkCooldown(interaction) {
    const { commandName, user } = interaction;
    const now = Date.now();
    const cooldowns = client.cooldowns.get(commandName) || new Map();
    client.cooldowns.set(commandName, cooldowns);

    if (cooldowns.has(user.id) && now < cooldowns.get(user.id) + CONFIG.COOLDOWN_MS) {
      await interaction.reply({ 
        content: `⏳ Cooldown, wait **${((cooldowns.get(user.id) + CONFIG.COOLDOWN_MS - now) / 1000).toFixed(1)}s** to reuse **/${commandName}**`, 
        ephemeral: true 
      });
      return false;
    }
    
    cooldowns.set(user.id, now);
    state.commandUsage++;
    return true;
  },

  async handleCheckCommand(interaction) {
    const robloxUsername = interaction.options.getString('username');
    
    try {
      await interaction.editReply({ content: `⏳ Looking up **${robloxUsername}**.. (**1/4**)` });
      const robloxInfo = await RobloxService.getUserInfo(robloxUsername);
      
      await interaction.editReply({ content: `⏳ Found em, fetching **${robloxUsername}**'s groups.. (**2/4**)` });
      
      const userGroups = await RobloxService.getUserGroups(robloxInfo.userId);
      const rankInEiserner = userGroups.find(g => g.group.id === CONFIG.EISERNER_GROUP_ID)?.role.name || null;
      
      const affiliatedGroups = CONFIG.NOTABLE_GROUP_IDS
        .filter(id => userGroups.some(g => g.group.id === id))
        .map(id => {
          const group = userGroups.find(g => g.group.id === id);
          return {
            id,
            name: group.group.name,
            role: group.role.name
          };
        });
      
      await interaction.editReply({ content: `⏳ Found ${affiliatedGroups.length} notable groups, now looking at **${robloxUsername}**'s friends.. (**3/4**)` });
      
      const friendsPromise = RobloxService.getUserFriends(robloxInfo.userId);
      
      const timeoutPromise = new Promise(resolve => {
        setTimeout(() => resolve([]), 30000);
      });
      
      const initialEmbed = new EmbedBuilder()
        .setTitle(`${robloxInfo.displayName} (@${robloxInfo.username})`)
        .setURL(robloxInfo.profileUrl)
        .setColor(robloxInfo.statusColor)
        .setThumbnail(robloxInfo.avatarUrl || null)
        .addFields(
          { 
            name: '🌐 Status', 
            value: `${robloxInfo.statusEmoji} ${robloxInfo.lastLocation}`, 
            inline: true 
          },
          { 
            name: '🇩🇪 Eiserner Vorhang', 
            value: rankInEiserner ? `✅ EV Member • **${rankInEiserner}**` : '❌ Not an EV Member', 
            inline: true 
          }
        );
      
      if (affiliatedGroups.length) {
        initialEmbed.addFields({
          name: `📋 Other Affiliations (${affiliatedGroups.length})`,
          value: '⏳ Fetching the data we collected..',
          inline: false
        });
      }
      
      await interaction.editReply({ 
        content: `⏳ Finishing up **${robloxUsername}**'s check.. (**4/4**)`,
        embeds: [initialEmbed]
      });
      
      const friends = await Promise.race([friendsPromise, timeoutPromise]);
      
      const { embed, totalPages } = EmbedHelper.createDynamicEmbed(
        robloxInfo, 
        rankInEiserner, 
        affiliatedGroups, 
        friends
      );
      
      const components = [ButtonHelper.createButtons(robloxUsername, totalPages, 1)];
      
      return interaction.editReply({ 
        content: null,
        embeds: [embed], 
        components: components 
      });
    } catch (error) {
      let errorMessage = error.message;
      if (errorMessage.includes('timeout')) {
        errorMessage = "❌ Couldn't finish in time, the profile may be too large or Roblox might be having issues.";
      }
      
      throw new Error(`${errorMessage}`);
    }
  },

  async handleInviteCommand(interaction) {
    const inviteEmbed = new EmbedBuilder()
      .setTitle('🇩🇪 Ein Berliner')
      .setDescription('Thank you for choosing me!')
      .setColor(0xFFFFFF)
      .addFields(
        {
          name: '',
          value: '**🤔 How can I trust you?**\n' +
                 '[I’m EV approved!](https://media.discordapp.net/attachments/1345418675418693703/1346590215325618216/image.png?ex=67d1f7dd&is=67d0a65d&hm=3749aef1eccf0931336d26cb42ede8e12b3925b25bf1a523cd6f7b03760c1060&=&format=webp&quality=lossless&width=454&height=371)\n\n' +
                 '**📃 What do you log?**\n' +
                 'I take security and privacy seriously, we only log the essentials, **nothing that could ever reveal who our users are**.\n\n' +
                 '**👾 Who created you?**\n' +
                 'I was created by [Sina](https://discord.com/users/751648406363176960).\n\n' +
                 '**💭 Why?**\n' +
                 'Because Ein Berliner makes OSINT (*Open Source Intel*) easy—no headaches, no unnecessary steps, just quick and convenient info scraping.',
          inline: false
        }
      )
      .setThumbnail(client.user.displayAvatarURL())
      .setFooter({ 
        text: 'Made with ❤️',
        iconURL: client.user.displayAvatarURL()
      })
      .setTimestamp();
  
    const inviteButton = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('Invite Me!')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.com/oauth2/authorize?client_id=1344030239344427040')
          .setEmoji('📨')
      );
  
    return interaction.editReply({
      embeds: [inviteEmbed],
      components: [inviteButton]
    });
  },

  async handleGameCommand(interaction) {
    const gameId = interaction.options.getString('id');
    const idType = interaction.options.getString('id_type') || 'place';
  
    try {
      Logger.log(`Fetching game data for: ${gameId} (Type: ${idType})`);
      await interaction.editReply({ content: `⏳ Looking up **${gameId}**.. (1/5)` });
  
      let universeId = gameId;
  
      if (idType === 'place') {
        await interaction.editReply({ content: `⏳ Converting **${gameId}**.. (1.5/5)` });
        const placeResponse = await fetch(`https://apis.roblox.com/universes/v1/places/${gameId}/universe`);
        if (!placeResponse.ok) {
          Logger.error(`Place-to-universe API failed with status: ${placeResponse.status} - ${placeResponse.statusText}`);
          throw new Error(`Failed to convert Place ID to Universe ID: ${placeResponse.status}`);
        }
        const placeData = await placeResponse.json();
        universeId = placeData.universeId;
  
        if (!universeId) {
          return interaction.editReply(`❌ **Faced an exception:** ${gameId}** couldn't be converted.**`);
        }
        await interaction.editReply({ content: `♻️ Converted to **${universeId}**, now checking it out.. (2/5)` });
      } else {
        await interaction.editReply({ content: `⏳ Using **${gameId}**, now checking it out.. (2/5)` });
      }
  

      const gameResponse = await fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
      if (!gameResponse.ok) {
        Logger.error(`Game API failed with status: ${gameResponse.status} - ${gameResponse.statusText}`);
        throw new Error(`Game API responded with status: ${gameResponse.status}`);
      }
      const gameData = await gameResponse.json();
  
      if (!gameData.data || gameData.data.length === 0) {
        return interaction.editReply(`❌ No game was found with ${idType === 'universe' ? 'Universe' : 'Place'} ID **${gameId}**!`);
      }
  
      const game = gameData.data[0];
      await interaction.editReply({ content: `🔭 Found **${game.name}**, Now gathering data.. (3/5)` });
  
      await interaction.editReply({ content: `⏳ Fetching the data we collected on **${game.name}**.. (4/5)` });
      const [mediaResponse, badgesResponse, socialLinksResponse, votesResponse] = await Promise.all([
        fetch(`https://games.roblox.com/v1/games/${universeId}/media`),
        fetch(`https://badges.roblox.com/v1/universes/${universeId}/badges?limit=5&sortOrder=Asc`),
        fetch(`https://games.roblox.com/v1/games/${universeId}/social-links/list`),
        fetch(`https://games.roblox.com/v1/games/${universeId}/votes`)
      ]);
  
      const [gameMediaData, gameBadges, socialLinks, votesData] = await Promise.all([
        mediaResponse.ok ? mediaResponse.json() : { data: [] },
        badgesResponse.ok ? badgesResponse.json() : { data: [] },
        socialLinksResponse.ok ? socialLinksResponse.json() : { data: [] },
        votesResponse.ok ? votesResponse.json() : { upVotes: 0, downVotes: 0 }
      ]);
  
      if (!mediaResponse.ok) Logger.warn(`Failed to fetch media for game ${universeId}: ${mediaResponse.status}`);
      if (!badgesResponse.ok) Logger.warn(`Failed to fetch badges for game ${universeId}: ${badgesResponse.status}`);
      if (!socialLinksResponse.ok) Logger.warn(`Failed to fetch social links for game ${universeId}: ${socialLinksResponse.status}`);
      if (!votesResponse.ok) Logger.warn(`Failed to fetch votes for game ${universeId}: ${votesResponse.status}`);
  
      await interaction.editReply({ content: `⏳ Processing **${game.name}**.. (5/5)` });
  
      const creatorInfo = this.processCreatorInfo(game.creator);
      const voteInfo = this.processVoteInfo(votesData);
      const createdDate = moment(game.created).format('MMM D, YYYY');
      const updatedDate = moment(game.updated).format('MMM D, YYYY');
      const thumbnailUrl = this.findBestThumbnail(gameMediaData.data);
      const genres = this.processGenres(game.genres);
      const gameStatsValue = this.buildGameStatsField(game, voteInfo);
      const detailsValue = this.buildDetailsField(game, creatorInfo, genres, createdDate, updatedDate);
      const embed = this.buildGameEmbed(game, gameId, thumbnailUrl, gameStatsValue, detailsValue, creatorInfo);
      const buttons = this.buildGameButtons(game, gameId, creatorInfo, socialLinks);
      const badgesEmbed = this.buildBadgesEmbed(game, gameBadges);
  
      await interaction.editReply({ content: `⏳ Finalizing **${game.name}**...` });
  
      if (badgesEmbed) {
        return interaction.editReply({
          content: null,
          embeds: [embed, badgesEmbed],
          components: [buttons]
        });
      } else {
        return interaction.editReply({
          content: null,
          embeds: [embed],
          components: [buttons]
        });
      }
    } catch (error) {
      Logger.error(`Error fetching game data for ID ${gameId} (Type: ${idType}): ${error.message}`);
      return interaction.editReply(`❌ Error fetching game: ${error.message}`);
    }
  },

  processCreatorInfo(creator) {
    if (!creator) {
      return {
        name: "Unknown",
        type: "Unknown",
        id: null,
        prefix: "❓",
        url: null
      };
    }
    
    const type = creator.type === "Group" ? "Group" : "User";
    return {
      name: creator.name || "Unknown",
      type: type,
      id: creator.id,
      prefix: type === "Group" ? "🏢" : "👤",
      url: `https://www.roblox.com/${type === 'Group' ? 'groups' : 'users'}/${creator.id}`
    };
  },

  processVoteInfo(votesData) {
    const totalVotes = votesData.upVotes + votesData.downVotes;
    const percentage = totalVotes > 0 ? Math.round((votesData.upVotes / totalVotes) * 100) : 0;
    
    let ratingEmoji = "⭐";
    if (percentage >= 90) ratingEmoji = "🌟";
    else if (percentage >= 75) ratingEmoji = "⭐";
    else if (percentage >= 50) ratingEmoji = "✨";
    else if (percentage >= 25) ratingEmoji = "⚠️";
    else ratingEmoji = "👎";
    
    return {
      upVotes: votesData.upVotes,
      downVotes: votesData.downVotes,
      total: totalVotes,
      percentage: percentage,
      emoji: ratingEmoji
    };
  },

  findBestThumbnail(mediaData) {
    const preferredTypes = [
        "Screenshot", 
        "GameThumbnail", 
        "IconSize512x512", 
        "GameIcon"
    ];
    for (const type of preferredTypes) {
        const media = mediaData.find(m => m.type === type);
        if (media?.imageUrl) return media.imageUrl;
    }
    return mediaData[0]?.imageUrl || null;
  },

  processGenres(genres) {
    if (!genres || genres.length === 0) return 'None';
    return genres.map(genre => genre.name).join(', ');
  },

  buildGameStatsField(game, voteInfo) {
    return stripIndent`
        👥 Players: **${(game.playing || 0).toLocaleString()}${game.maxPlayers ? ` / ${game.maxPlayers.toLocaleString()}**` : ''}
        👁️ Visits: **${(game.visits || 0).toLocaleString()}**
        ❤️ Favorites: **${(game.favoritedCount || 0).toLocaleString()}**
        ${voteInfo.emoji} Rating: **${voteInfo.percentage}%**`;
  },

  buildDetailsField(game, creatorInfo, genres, createdDate, updatedDate) {
    return stripIndent`
        ${creatorInfo.prefix} Creator: **[${creatorInfo.name}](${creatorInfo.url})** (${creatorInfo.type})
        📅 Created: **${createdDate}**
        🔄 Updated: **${updatedDate}**
    `;
  },

  buildGameEmbed(game, gameId, thumbnailUrl, gameStatsValue, detailsValue, creatorInfo) {
    let embedColor = 0x00A2FF;
    if (game.price && game.price > 0) {
      embedColor = 0xFFD700;
    } else if (game.playing > 1000) {
      embedColor = 0x00FF00;
    }

    const embed = new EmbedBuilder()
        .setTitle(`${game.name || 'Unknown'}`)
        .setURL(`https://www.roblox.com/games/${game.rootPlaceId || gameId}`)
        .setColor(embedColor)
        .setDescription(
            game.description 
                ? '```md\n' + EmbedHelper.smartTruncate(game.description, 999) + '\n```'
                : '```md\nNo description.\n```'
        )
        .setImage(thumbnailUrl || 'https://via.placeholder.com/512x256.png?text=No+Thumbnail')
        .addFields(
            { 
                name: '🗽 Metrics', 
                value: gameStatsValue, 
                inline: true 
            },
            { 
                name: 'ℹ️ Information', 
                value: detailsValue, 
                inline: true 
            }
        )
        .setFooter({
            text: `⚠️ Data may be incomplete! • ${game.playableDevices?.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ') || 'All'} devices supported.`
        })
        .setTimestamp();

    return embed;
  },

  buildGameButtons(game, gameId, creatorInfo, socialLinks) {
    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('Play')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://www.roblox.com/games/${game.rootPlaceId || gameId}`)
          .setEmoji('🎮'),
        new ButtonBuilder()
          .setLabel(`View ${creatorInfo.type}`)
          .setStyle(ButtonStyle.Link)
          .setURL(creatorInfo.url)
          .setEmoji(creatorInfo.prefix)
      );
    const discordLink = socialLinks.data?.find(link => link.type === "Discord");
    if (discordLink) {
      buttons.addComponents(
        new ButtonBuilder()
          .setLabel('Join Discord')
          .setStyle(ButtonStyle.Link)
          .setURL(discordLink.url)
          .setEmoji('🔗')
      );
    }
    const twitterLink = socialLinks.data?.find(link => 
      link.type === "Twitter" || link.type === "X" || link.title?.toLowerCase().includes('twitter')
    );
    if (twitterLink && buttons.components.length < 5) {
      buttons.addComponents(
        new ButtonBuilder()
          .setLabel('Twitter (or X)')
          .setStyle(ButtonStyle.Link)
          .setURL(twitterLink.url)
          .setEmoji('🐦')
      );
    }
    return buttons;
  },

  buildBadgesEmbed(game, gameBadges) {
    if (!gameBadges.data || gameBadges.data.length === 0) {
      return null;
    }
    const badgesEmbed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle('🏅 Game Badges')
      .setFooter({ text: '⚠️ only a few badges are shown • there may be more!' });
    const totalBadges = gameBadges.data.length;
    const displayedBadges = Math.min(totalBadges, 5);
    badgesEmbed.setDescription(
      totalBadges > displayedBadges 
        ? `Showing ${displayedBadges} of ${totalBadges} badges available in ${game.name}:`
        : `${game.name} offers these ${totalBadges} badges to earn:`
    );
    const badgeEmojis = ['🥇', '🥈', '🥉', '🏅', '🎖️'];
    gameBadges.data.slice(0, 5).forEach((badge, index) => {
      const emoji = badgeEmojis[index] || '🏆';
      badgesEmbed.addFields({
        name: `${emoji} ${badge.name}`,
        value: badge.description 
          ? EmbedHelper.smartTruncate(badge.description, 100)
          : '*No description available*',
        inline: true
      });
    });
    return badgesEmbed;
  },

  async handleHelpCommand(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('❓ Help')
      .setColor(0xc0043c)
      .addFields(commands.map(c => ({ 
        name: `/${c.name}`, 
        value: c.description, 
        inline: true 
      })))
      .setFooter({ text: `There's a ${CONFIG.COOLDOWN_MS / 1000}s cooldown!` });
    
    return interaction.editReply({ embeds: [embed] });
  },

  async handle(interaction) {
    if (!(await this.checkCooldown(interaction))) return;
    await interaction.deferReply();
    
    const { commandName, user } = interaction;
    const username = user.tag;

    try {
      switch (commandName) {
        case 'check':
          return await this.handleCheckCommand(interaction);
        case 'game':
          return await this.handleGameCommand(interaction);
        case 'help':
          return await this.handleHelpCommand(interaction);
        case 'invite':
           return await this.handleInviteCommand(interaction);
        default:
          return interaction.editReply('Unknown or invalid command, run **/help**.');
      }
    } catch (error) {
      await Logger.error(`${commandName} failed for ${username}: ${error.message}`);
      await interaction.editReply(`❌ Faced an exception: **${error.message}**`);
    }
  }
};

const ButtonHandler = {
  async handle(interaction) {
    const customId = interaction.customId;
    
    if (customId.startsWith('prev_') || customId.startsWith('next_')) {
      const [action, username, currentPageStr] = customId.split('_');
      const currentPage = parseInt(currentPageStr);
      const newPage = action === 'prev' ? currentPage - 1 : currentPage + 1;
      
      try {
        await interaction.update({ content: `⏳ Loading Page **${newPage}**..`, components: [] });
        
        const robloxInfo = await RobloxService.getUserInfo(username);
        
        const [friends, userGroups] = await Promise.all([
          RobloxService.getUserFriends(robloxInfo.userId),
          RobloxService.getUserGroups(robloxInfo.userId)
        ]);
        
        const rankInEiserner = userGroups.find(g => g.group.id === CONFIG.EISERNER_GROUP_ID)?.role.name || null;
        
        const affiliatedGroups = CONFIG.NOTABLE_GROUP_IDS
          .filter(id => userGroups.some(g => g.group.id === id))
          .map(id => {
            const group = userGroups.find(g => g.group.id === id);
            return {
              id,
              name: group.group.name,
              role: group.role.name
            };
          });
        
        const { embed, totalPages } = EmbedHelper.createDynamicEmbed(
          robloxInfo, 
          rankInEiserner, 
          affiliatedGroups, 
          friends, 
          newPage
        );
        
        await interaction.editReply({ 
          content: null,
          embeds: [embed], 
          components: [ButtonHelper.createButtons(username, totalPages, newPage)] 
        });
      } catch (error) {
        await Logger.error(`Couldn't handle pagination: ${error.message}`);
        await interaction.editReply({ 
          content: `❌ Error: **${error.message}**`, 
          embeds: [], 
          components: [] 
        });
      }
    } else if (customId.startsWith('altcheck_')) {
      const parts = customId.split('_');
      const username = parts.slice(1).join('_');
      try {
        await interaction.update({
          content: `⏳ Checking if **${username}** is suspicious, just a sec..`,
          components: [],
          embeds: []
        });
        const robloxInfo = await RobloxService.getUserInfo(username);
        const altResult = await AltDetectorService.detectAlt(robloxInfo.userId);
        altResult.username = username;
        const altEmbed = new EmbedBuilder()
          .setTitle(`🎭 ${robloxInfo.displayName} (@${robloxInfo.username})`)
          .setURL(robloxInfo.profileUrl)
          .setColor(0xa4d884)
          .addFields(
            { name: '🕒 Age', value: `${altResult.accountAgeDays} days`, inline: true },
            { name: '🪭 Followers', value: `${altResult.followerCount}`, inline: true },
            { name: '🫂 Friends', value: `${altResult.friendCount}`, inline: true },
            { name: '🏅 Badges', value: `${altResult.badgeCount}`, inline: true },
            { name: '🎮 Games', value: `${altResult.gameCount}`, inline: true },
            { name: '🏘️ Groups', value: `${altResult.groupCount}`, inline: true },
            { name: 'Conclusion', value: `**${altResult.judgment}**`, inline: false }
          )
          .setFooter({ text: '⚠️ This check is heuristical • May not be fully accurate!' })
          .setTimestamp();
        await interaction.editReply({
          content: null,
          embeds: [altEmbed],
          components: [ButtonHelper.createAltButtons(username)]
        });
      } catch (error) {
        await Logger.error(`Alt check failed for ${username}: ${error.message}`);
        await interaction.editReply({
          content: `❌ Failed to check: **${error.message}**`,
          embeds: [],
          components: []
        });
      }
    } else if (customId.startsWith('badgechart_')) {
      const parts = customId.split('_');
      const username = parts.slice(1).join('_');
      try {
        await interaction.update({
          content: `⏳ Making chart for **${username}**..`,
          components: [],
          embeds: []
        });
        const robloxInfo = await RobloxService.getUserInfo(username);
        const altResult = await AltDetectorService.detectAlt(robloxInfo.userId);
        const chartUrl = await AltDetectorService.createBadgeChart(altResult.badges, robloxInfo.username);
        if (!chartUrl) {
          await interaction.editReply({
            content: `❌ **${username}** has no badges!`,
            embeds: [],
            components: []
          });
          return;
        }
        const chartEmbed = new EmbedBuilder()
          .setTitle(`📊 ${robloxInfo.displayName} (@${robloxInfo.username})`)
          .setURL(robloxInfo.profileUrl)
          .setColor(0xc0043c)
          .setImage(chartUrl)
          .setFooter({ text: '⚠️ The chart depicts badges in months!' })
          .setTimestamp();
        await interaction.editReply({
          content: null,
          embeds: [chartEmbed],
          components: []
        });
      } catch (error) {
        await Logger.error(`Chart generation failed for ${username}: ${error.message}`);
        await interaction.editReply({
          content: `❌ Failed to generate chart: **${error.message}**`,
          embeds: [],
          components: []
        });
      }
    } else if (customId.startsWith('explain_alt_')) {
      const parts = customId.split('_');
      const username = parts.slice(2).join('_');
      try {
        await interaction.deferReply({ ephemeral: true });
        const robloxInfo = await RobloxService.getUserInfo(username);
        const altResult = await AltDetectorService.detectAlt(robloxInfo.userId);
        altResult.username = username;
        const explanation = AltDetectorService.generateExplanation(altResult);
        await interaction.editReply({
          content: `${explanation}`,
          ephemeral: true
        });
      } catch (error) {
        await Logger.error(`Failed to generate explanation for ${username}: ${error.message}`);
        await interaction.editReply({
          content: `❌ Faced an exception: ${error.message}`,
          ephemeral: true
        });
      }
    }
  }
};

client.once('ready', async () => {
  await Logger.log(`Hello from ${client.user.tag}`);
  
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    await Logger.log('Successfully registered all dependencies.');
  } catch (error) {
    await Logger.error(`Couldn't register dependency: ${error.message}`);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isCommand()) {
    return CommandHandler.handle(interaction);
  }
  
  if (interaction.isButton() && 
     (interaction.customId.startsWith('prev_') || 
      interaction.customId.startsWith('next_') || 
      interaction.customId.startsWith('altcheck_') || 
      interaction.customId.startsWith('badgechart_') ||
      interaction.customId.startsWith('explain_alt_'))) {
    return ButtonHandler.handle(interaction);
  }
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
  Logger.log(`Couldn't log in: ${error.message}`);
  process.exit(1);
});