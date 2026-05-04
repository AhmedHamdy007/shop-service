const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shop-stylist-test-"));
const privateKeyPath = path.join(tmpDir, "private.pem");
const publicKeyPath = path.join(tmpDir, "public.pem");
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
fs.writeFileSync(privateKeyPath, privateKey, "utf8");
fs.writeFileSync(publicKeyPath, publicKey, "utf8");

process.env.PORT = "4002";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "INFO";
process.env.DATABASE_URL = "postgresql://unused";
process.env.AUTH_SERVICE_URL = "http://localhost:4001";
process.env.JWT_PUBLIC_KEY_PATH = publicKeyPath;
process.env.JWT_ISSUER = "salon-platform.auth";
process.env.JWT_AUDIENCE = "salon-platform.api";

jest.mock("../src/db/pool", () => ({
  healthCheck: jest.fn(),
}));

jest.mock("../src/repositories/shopRepository", () => ({
  createShop: jest.fn(),
  findShopById: jest.fn(),
  findPublicShopById: jest.fn(),
  findActiveShopByOwnerUserId: jest.fn(),
  listShops: jest.fn(),
  updateShopById: jest.fn(),
}));

jest.mock("../src/repositories/serviceRepository", () => ({
  createService: jest.fn(),
  listServicesByShop: jest.fn(),
  findServiceById: jest.fn(),
  updateServiceById: jest.fn(),
}));

jest.mock("../src/repositories/staffRepository", () => ({
  listStaffByShop: jest.fn(),
  listActiveStylistsByShop: jest.fn(),
  findStaffById: jest.fn(),
  findStaffByShopAndUser: jest.fn(),
  findActiveMembershipByUser: jest.fn(),
  createStaffMembership: jest.fn(),
  updateStaffById: jest.fn(),
  listShopsForStylist: jest.fn(),
}));

jest.mock("../src/repositories/inviteRepository", () => ({
  createInvite: jest.fn(),
  listInvitesByShop: jest.fn(),
  findActiveInviteByShopAndEmail: jest.fn(),
  findInviteById: jest.fn(),
  findActiveInviteByToken: jest.fn(),
  markInviteAccepted: jest.fn(),
  revokeInvite: jest.fn(),
}));

jest.mock("../src/repositories/stylistProfileRepository", () => ({
  getByUserId: jest.fn(),
  getPublicProfileByIdentifier: jest.fn(),
  listPublicProfiles: jest.fn(),
  listPublicProfilesByShopId: jest.fn(),
  upsertByUserId: jest.fn(),
}));

jest.mock("../src/repositories/portfolioRepository", () => ({
  listByStylist: jest.fn(),
  findById: jest.fn(),
  createPost: jest.fn(),
  updatePost: jest.fn(),
  replaceMedia: jest.fn(),
  deletePost: jest.fn(),
}));

jest.mock("../src/repositories/offeringRepository", () => ({
  upsertOffering: jest.fn(),
  listByShopAndStylist: jest.fn(),
  deactivate: jest.fn(),
}));

const staffRepository = require("../src/repositories/staffRepository");
const inviteRepository = require("../src/repositories/inviteRepository");
const stylistProfileRepository = require("../src/repositories/stylistProfileRepository");
const portfolioRepository = require("../src/repositories/portfolioRepository");
const offeringRepository = require("../src/repositories/offeringRepository");
const shopRoutes = require("../src/routes/shop.routes");
const stylistRoutes = require("../src/routes/stylist.routes");
const errorHandler = require("../src/middleware/errorHandler");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.id = "test-request-id";
    next();
  });
  app.use(shopRoutes);
  app.use(stylistRoutes);
  app.use(errorHandler);
  return app;
}

function signAccessToken(sub = 9) {
  return jwt.sign({ sub }, privateKey, {
    algorithm: "RS256",
    issuer: "salon-platform.auth",
    audience: "salon-platform.api",
    keyid: "auth-rs256-k1",
    expiresIn: "15m",
  });
}

function mockCurrentUser(user) {
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ success: true, data: user }),
  });
}

describe("Shop Service Sprint 2 stylist flows", () => {
  let app;

  beforeEach(() => {
    jest.resetAllMocks();
    app = createApp();
  });

  it("blocks invite acceptance when the invite email does not match the current stylist", async () => {
    mockCurrentUser({ id: 9, email: "stylist@example.com", role: "stylist" });
    inviteRepository.findActiveInviteByToken.mockResolvedValueOnce({
      id: 12,
      shopId: 7,
      email: "other@example.com",
      staffLevel: "stylist",
    });
    staffRepository.findActiveMembershipByUser.mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/shops/invites/accept")
      .set("Authorization", `Bearer ${signAccessToken(9)}`)
      .send({ token: "abcdefghijklmnopqrstuvwxyz123456" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Invite email does not match current stylist");
  });

  it("blocks invite acceptance when the stylist already belongs to another active shop", async () => {
    mockCurrentUser({ id: 9, email: "stylist@example.com", role: "stylist" });
    inviteRepository.findActiveInviteByToken.mockResolvedValueOnce({
      id: 12,
      shopId: 7,
      email: "stylist@example.com",
      staffLevel: "senior_stylist",
    });
    staffRepository.findActiveMembershipByUser.mockResolvedValueOnce({
      id: 30,
      shopId: 3,
      userId: 9,
      status: "active",
    });

    const res = await request(app)
      .post("/shops/invites/accept")
      .set("Authorization", `Bearer ${signAccessToken(9)}`)
      .send({ token: "abcdefghijklmnopqrstuvwxyz123456" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Stylist already belongs to another active shop");
  });

  it("accepts a valid invite and creates stylist membership", async () => {
    mockCurrentUser({ id: 9, email: "stylist@example.com", role: "stylist" });
    inviteRepository.findActiveInviteByToken.mockResolvedValueOnce({
      id: 12,
      shopId: 7,
      email: "stylist@example.com",
      staffLevel: "senior_stylist",
    });
    staffRepository.findActiveMembershipByUser.mockResolvedValueOnce(null);
    staffRepository.findStaffByShopAndUser.mockResolvedValueOnce(null);
    staffRepository.createStaffMembership.mockResolvedValueOnce({
      id: 41,
      shopId: 7,
      userId: 9,
      staffLevel: "senior_stylist",
      status: "active",
    });
    inviteRepository.markInviteAccepted.mockResolvedValueOnce({
      id: 12,
      acceptedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post("/shops/invites/accept")
      .set("Authorization", `Bearer ${signAccessToken(9)}`)
      .send({ token: "abcdefghijklmnopqrstuvwxyz123456" });

    expect(res.status).toBe(201);
    expect(staffRepository.createStaffMembership).toHaveBeenCalledWith({
      shopId: 7,
      userId: 9,
      staffLevel: "senior_stylist",
    });
    expect(inviteRepository.markInviteAccepted).toHaveBeenCalledWith(12);
  });

  it("updates the stylist public profile with validated fields", async () => {
    mockCurrentUser({ id: 9, email: "stylist@example.com", role: "stylist" });
    stylistProfileRepository.upsertByUserId.mockResolvedValueOnce({
      id: 5,
      userId: 9,
      displayName: "Ava Cuts",
      bio: "Precision fades and modern cuts",
      yearsExperience: 7,
      isPublic: true,
    });

    const res = await request(app)
      .patch("/stylists/me/profile")
      .set("Authorization", `Bearer ${signAccessToken(9)}`)
      .send({
        displayName: "Ava Cuts",
        bio: "Precision fades and modern cuts",
        yearsExperience: 7,
        isPublic: true,
      });

    expect(res.status).toBe(200);
    expect(stylistProfileRepository.upsertByUserId).toHaveBeenCalledWith(9, {
      display_name: "Ava Cuts",
      bio: "Precision fades and modern cuts",
      years_experience: 7,
      is_public: true,
    });
  });

  it("creates a portfolio post and exposes public profile, portfolio, and services reads", async () => {
    mockCurrentUser({ id: 9, email: "stylist@example.com", role: "stylist" });
    portfolioRepository.createPost.mockResolvedValueOnce({
      id: 22,
      stylistUserId: 9,
      title: "Sharp taper",
      caption: "Weekend transformation",
      isPublished: true,
      media: [{ id: 1, mediaUrl: "https://img.example.com/look-1.jpg" }],
    });
    stylistProfileRepository.getPublicProfileByIdentifier.mockResolvedValueOnce({
      id: 5,
      userId: 9,
      displayName: "Ava Cuts",
      isPublic: true,
    });
    portfolioRepository.listByStylist
      .mockResolvedValueOnce([
        {
          id: 22,
          stylistUserId: 9,
          title: "Sharp taper",
          isPublished: true,
        },
      ]);
    staffRepository.listShopsForStylist.mockResolvedValueOnce([{ id: 7, name: "Owner Shop" }]);
    offeringRepository.listByShopAndStylist.mockResolvedValueOnce([
      {
        id: 44,
        shopId: 7,
        stylistUserId: 9,
        serviceId: 12,
        isActive: true,
        service: {
          id: 12,
          name: "Haircut",
          durationMinutes: 45,
          price: 35,
          category: "Hair",
        },
      },
    ]);

    const createRes = await request(app)
      .post("/stylists/me/portfolio")
      .set("Authorization", `Bearer ${signAccessToken(9)}`)
      .send({
        title: "Sharp taper",
        caption: "Weekend transformation",
        isPublished: true,
        mediaUrls: ["https://img.example.com/look-1.jpg"],
      });

    expect(createRes.status).toBe(201);
    expect(portfolioRepository.createPost).toHaveBeenCalledWith({
      stylistUserId: 9,
      title: "Sharp taper",
      caption: "Weekend transformation",
      isPublished: true,
      mediaUrls: ["https://img.example.com/look-1.jpg"],
    });

    const profileRes = await request(app).get("/stylists/9/profile");
    expect(profileRes.status).toBe(200);
    expect(stylistProfileRepository.getPublicProfileByIdentifier).toHaveBeenCalledWith("9");

    const portfolioRes = await request(app).get("/stylists/9/portfolio");
    expect(portfolioRes.status).toBe(200);
    expect(portfolioRepository.listByStylist).toHaveBeenCalledWith("9", {
      includeUnpublished: false,
    });

    const servicesRes = await request(app).get("/stylists/9/services");
    expect(servicesRes.status).toBe(200);
    expect(offeringRepository.listByShopAndStylist).toHaveBeenCalledWith(7, "9");
  });

  it("supports public stylist profile reads by profile id as a legacy URL fallback", async () => {
    const profileId = "2f461642-f0b3-4458-b99c-53252cff7b44";
    stylistProfileRepository.getPublicProfileByIdentifier.mockResolvedValueOnce({
      id: profileId,
      userId: 9,
      displayName: "Ava Cuts",
      isPublic: true,
    });

    const res = await request(app).get(`/stylists/${profileId}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.data.userId).toBe(9);
    expect(stylistProfileRepository.getPublicProfileByIdentifier).toHaveBeenCalledWith(profileId);
  });

  it("returns current stylist shops and full self portfolio including unpublished posts", async () => {
    mockCurrentUser({ id: 9, email: "stylist@example.com", role: "stylist" });
    staffRepository.listShopsForStylist.mockResolvedValueOnce([
      { id: 7, name: "Owner Shop", isActive: true },
    ]);
    portfolioRepository.listByStylist.mockResolvedValueOnce([
      { id: 22, stylistUserId: 9, title: "Published look", isPublished: true },
      { id: 23, stylistUserId: 9, title: "Draft look", isPublished: false },
    ]);

    const token = signAccessToken(9);
    const shopsRes = await request(app)
      .get("/stylists/me/shops")
      .set("Authorization", `Bearer ${token}`);
    const portfolioRes = await request(app)
      .get("/stylists/me/portfolio")
      .set("Authorization", `Bearer ${token}`);

    expect(shopsRes.status).toBe(200);
    expect(shopsRes.body.count).toBe(1);
    expect(staffRepository.listShopsForStylist).toHaveBeenCalledWith(9);

    expect(portfolioRes.status).toBe(200);
    expect(portfolioRes.body.count).toBe(2);
    expect(portfolioRepository.listByStylist).toHaveBeenCalledWith(9, {
      includeUnpublished: true,
    });
  });

  it("updates portfolio post fields and media for the current stylist", async () => {
    mockCurrentUser({ id: 9, email: "stylist@example.com", role: "stylist" });
    portfolioRepository.findById.mockResolvedValueOnce({
      id: "post-1",
      stylistUserId: 9,
      title: "Sharp taper",
      caption: "Weekend transformation",
      isPublished: true,
    });
    portfolioRepository.updatePost.mockResolvedValueOnce({
      id: "post-1",
      stylistUserId: 9,
      title: "Sharp taper refresh",
      caption: "Updated caption",
      isPublished: false,
    });
    portfolioRepository.replaceMedia.mockResolvedValueOnce({
      id: "post-1",
      stylistUserId: 9,
      title: "Sharp taper refresh",
      caption: "Updated caption",
      isPublished: false,
      media: [{ id: "media-1", mediaUrl: "https://img.example.com/look-2.jpg" }],
    });

    const res = await request(app)
      .patch("/stylists/me/portfolio/post-1")
      .set("Authorization", `Bearer ${signAccessToken(9)}`)
      .send({
        title: "Sharp taper refresh",
        caption: "Updated caption",
        isPublished: false,
        mediaUrls: ["https://img.example.com/look-2.jpg"],
      });

    expect(res.status).toBe(200);
    expect(portfolioRepository.updatePost).toHaveBeenCalledWith("post-1", {
      title: "Sharp taper refresh",
      caption: "Updated caption",
      is_published: false,
    });
    expect(portfolioRepository.replaceMedia).toHaveBeenCalledWith("post-1", [
      "https://img.example.com/look-2.jpg",
    ]);
  });

  it("deletes an owned portfolio post", async () => {
    mockCurrentUser({ id: 9, email: "stylist@example.com", role: "stylist" });
    portfolioRepository.findById.mockResolvedValueOnce({
      id: "post-1",
      stylistUserId: 9,
    });
    portfolioRepository.deletePost.mockResolvedValueOnce(1);

    const res = await request(app)
      .delete("/stylists/me/portfolio/post-1")
      .set("Authorization", `Bearer ${signAccessToken(9)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true });
    expect(portfolioRepository.deletePost).toHaveBeenCalledWith("post-1");
  });

  it("hides a non-public stylist profile from public reads", async () => {
    stylistProfileRepository.getPublicProfileByIdentifier.mockResolvedValueOnce({
      id: 5,
      userId: 9,
      displayName: "Ava Cuts",
      isPublic: false,
    });

    const res = await request(app).get("/stylists/9/profile");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Stylist profile not found");
  });

  it("keeps unpublished posts out of public portfolio reads", async () => {
    portfolioRepository.listByStylist.mockResolvedValueOnce([
      { id: 22, stylistUserId: 9, title: "Published look", isPublished: true },
    ]);

    const res = await request(app).get("/stylists/9/portfolio");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(portfolioRepository.listByStylist).toHaveBeenCalledWith("9", {
      includeUnpublished: false,
    });
  });

  it("returns an empty public services list when the stylist has no active shop", async () => {
    staffRepository.listShopsForStylist.mockResolvedValueOnce([]);

    const res = await request(app).get("/stylists/9/services");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.data).toEqual([]);
    expect(offeringRepository.listByShopAndStylist).not.toHaveBeenCalled();
  });
});
