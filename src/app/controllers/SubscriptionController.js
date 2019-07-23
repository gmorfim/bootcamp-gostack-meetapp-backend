import * as Yup from 'yup';
import { parseISO, isBefore } from 'date-fns';
import { Op } from 'sequelize';
import Meetup from '../models/Meetup';
import Subscription from '../models/Subscription';
import User from '../models/User';
import Queue from '../../lib/Queue';
import SubscriptionMail from '../jobs/SubscriptionMail';

class SubscriptionController {
  async index(req, res) {
    const { page = 1 } = req.query;

    const subscriptions = await Subscription.findAll({
      where: {
        user_id: req.userId,
      },
      limit: 10,
      offset: (page - 1) * 10,
      attributes: [],
      include: {
        model: Meetup,
        required: true,
        order: ['date'],
        where: {
          date: {
            [Op.gte]: Date.now(),
          },
        },
        attributes: ['title', 'date'],
      },
    });

    res.json(subscriptions);
  }

  async store(req, res) {
    const user = await User.findByPk(req.userId);

    const meetup = await Meetup.findByPk(req.params.meetupId, {
      include: [User],
    });

    if (meetup.user_id === req.userId) {
      return res
        .status(400)
        .json({ error: "Can't subscribe for the meetup you host." });
    }

    if (meetup.past) {
      return res.status(400).json({
        error: "Can't subscribe past meetups.",
      });
    }

    const checkDate = await Subscription.findOne({
      where: {
        user_id: user.id,
      },
      include: [
        {
          model: Meetup,
          required: true,
          where: {
            date: meetup.date,
          },
        },
      ],
    });

    if (checkDate) {
      return res
        .status(400)
        .json({ error: "Can't subscribe to two meetups at the same time" });
    }

    const subscription = await Subscription.create({
      user_id: user.id,
      meetup_id: meetup.id,
    });

    const subscriptions = await Subscription.findAndCountAll({
      where: { meetup_id: meetup.id },
    });

    await Queue.add(SubscriptionMail.key, {
      meetup,
      user,
      quantity: subscriptions.count,
    });

    return res.json(subscription);
  }

  async update(req, res) {
    const schema = Yup.object().shape({
      title: Yup.string(),
      description: Yup.string(),
      location: Yup.string(),
      date: Yup.date(),
      banner_id: Yup.number(),
    });

    if (!(await schema.isValid(req.body))) {
      return res.status(400).json({ error: 'Validation fails' });
    }

    const meetup = await Meetup.findByPk(req.params.id);

    if (meetup.user_id !== req.userId) {
      return res.status(401).json({ error: 'Not authorized.' });
    }

    if (isBefore(parseISO(req.body.date), new Date())) {
      return res.status(400).json({
        error: 'Meetup date invalid',
      });
    }

    if (meetup.past) {
      return res.status(400).json({
        error: "Can't update past meetups.",
      });
    }

    await meetup.update(req.body);

    return res.json(meetup);
  }

  async delete(req, res) {
    const meetup = await Meetup.findByPk(req.params.id);

    if (meetup.user_id !== req.userId) {
      return res.status(401).json({ error: 'Not authorized.' });
    }

    if (meetup.past) {
      return res.status(400).json({
        error: "Can't cancelate past meetups.",
      });
    }

    await meetup.destroy();

    return res.send();
  }
}

export default new SubscriptionController();
