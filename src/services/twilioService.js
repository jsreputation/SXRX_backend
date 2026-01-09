const twilio = require('twilio');

class TwilioService {
  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.apiKey = process.env.TWILIO_API_KEY;
    this.apiSecret = process.env.TWILIO_API_SECRET;
    this.client = twilio(this.accountSid, this.authToken);
  }

  async createRoom(roomName) {
    try {
      const room = await this.client.video.rooms.create({
        uniqueName: roomName,
        type: 'go',
        recordParticipantsOnConnect: true,
        statusCallback: `${process.env.API_URL}/api/consultations/room-status`,
      });
      return room;
    } catch (error) {
      console.error('Failed to create Twilio room:', error);
      throw error;
    }
  }

  async generateAccessToken(identity, roomName) {
    try {
      const AccessToken = twilio.jwt.AccessToken;
      const VideoGrant = AccessToken.VideoGrant;

      const accessToken = new AccessToken(
        this.accountSid,
        this.apiKey,
        this.apiSecret,
        { identity }
      );

      const videoGrant = new VideoGrant({
        room: roomName,
      });

      accessToken.addGrant(videoGrant);
      return accessToken.toJwt();
    } catch (error) {
      console.error('Failed to generate access token:', error);
      throw error;
    }
  }

  async endRoom(roomName) {
    try {
      const room = await this.client.video.rooms(roomName).update({
        status: 'completed',
      });
      return room;
    } catch (error) {
      console.error('Failed to end Twilio room:', error);
      throw error;
    }
  }

  async getRoomParticipants(roomName) {
    try {
      const participants = await this.client.video.rooms(roomName).participants.list();
      return participants;
    } catch (error) {
      console.error('Failed to get room participants:', error);
      throw error;
    }
  }
}

module.exports = new TwilioService(); 