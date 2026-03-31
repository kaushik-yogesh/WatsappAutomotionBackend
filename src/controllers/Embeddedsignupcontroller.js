const axios = require('axios');
const WhatsappAccount = require('../models/WhatsappAccount');
const AppError = require('../utils/AppError');
const { encrypt } = require('../utils/encryption');
const logger = require('../utils/logger');

const META_API_BASE = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v18.0'}`;

// Step 1: Exchange short-lived code for long-lived System User token
// Called after user completes Facebook Embedded Signup flow


exports.embeddedSignupCallback = async (req, res, next) => {
    try {
        const { code } = req.body;
        if (!code) return next(new AppError('Authorization code is required.', 400));

        // Exchange code for access token
        const tokenRes = await axios.get(`${META_API_BASE}/oauth/access_token`, {
            params: {
                client_id: process.env.META_APP_ID,
                client_secret: process.env.META_APP_SECRET,
                code,
                redirect_uri: "https://watsapp-automotion.vercel.app/callback"
            },
        });

        const shortLivedToken = tokenRes.data.access_token;

        // Exchange short-lived for long-lived token
        const longLivedRes = await axios.get(`${META_API_BASE}/oauth/access_token`, {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: process.env.META_APP_ID,
                client_secret: process.env.META_APP_SECRET,
                fb_exchange_token: shortLivedToken,
                redirect_uri: "https://watsapp-automotion.vercel.app/callback"
            },
        });

        const longLivedToken = longLivedRes.data.access_token;

        // Get WABA and phone number info from the token
        const wabaRes = await axios.get(`${META_API_BASE}/me/businesses`, {
            params: {
                access_token: longLivedToken,
                fields: 'id,name,whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}',
            },
        });

        const businesses = wabaRes.data.data || [];
        const phoneNumbers = [];

        for (const biz of businesses) {
            const wabas = biz.whatsapp_business_accounts?.data || [];
            for (const waba of wabas) {
                const phones = waba.phone_numbers?.data || [];
                for (const phone of phones) {
                    phoneNumbers.push({
                        phoneNumberId: phone.id,
                        wabaId: waba.id,
                        wabaName: waba.name,
                        displayPhoneNumber: phone.display_phone_number,
                        verifiedName: phone.verified_name,
                    });
                }
            }
        }

        res.status(200).json({
            status: 'success',
            data: {
                longLivedToken,
                phoneNumbers,
            },
        });
    } catch (err) {
        const metaErr = err.response?.data?.error;
        logger.error('Embedded signup token exchange error:', metaErr || err.message);
        const msg = metaErr?.message || 'Failed to complete WhatsApp signup. Please try again.';
        next(new AppError(msg, 502));
    }
};




// Step 2: Save selected phone number after user picks from list
exports.embeddedSignupSave = async (req, res, next) => {
    try {
        const { phoneNumberId, wabaId, accessToken, displayPhoneNumber, verifiedName } = req.body;

        if (!phoneNumberId || !wabaId || !accessToken) {
            return next(new AppError('phoneNumberId, wabaId, and accessToken are required.', 400));
        }

        // Check duplicate
        const existing = await WhatsappAccount.findOne({ phoneNumberId });
        if (existing && existing.user.toString() !== req.user._id.toString()) {
            return next(new AppError('This number is already connected to another account.', 400));
        }

        // Check plan limit
        const count = await WhatsappAccount.countDocuments({
            user: req.user._id,
            isActive: true,
            ...(existing ? { _id: { $ne: existing._id } } : {}),
        });
        const limits = req.user.getPlanLimits();
        if (!existing && count >= limits.agents) {
            return next(new AppError(`Your plan allows only ${limits.agents} number(s). Please upgrade.`, 403));
        }

        // Subscribe to webhook for this WABA (register webhook on Meta side)
        try {
            await axios.post(
                `${META_API_BASE}/${wabaId}/subscribed_apps`,
                {},
                { params: { access_token: accessToken } }
            );
            logger.info(`Webhook subscribed for WABA: ${wabaId}`);
        } catch (subErr) {
            logger.warn('Webhook subscription warning:', subErr.response?.data?.error?.message);
        }

        const account = await WhatsappAccount.findOneAndUpdate(
            { phoneNumberId },
            {
                user: req.user._id,
                phoneNumberId,
                wabaId,
                accessToken: encrypt(accessToken),
                displayPhoneNumber,
                verifiedName,
                status: 'connected',
                lastVerified: new Date(),
                webhookVerified: true,
                isActive: true,
                errorMessage: undefined,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        const accountObj = account.toObject();
        delete accountObj.accessToken;

        logger.info(`Account connected via Embedded Signup: ${displayPhoneNumber} for user ${req.user._id}`);

        res.status(201).json({
            status: 'success',
            message: `${displayPhoneNumber} connected successfully!`,
            data: { account: accountObj },
        });
    } catch (err) {
        logger.error('Embedded signup save error:', err);
        next(err);
    }
};