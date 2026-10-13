import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useT } from '../i18n.jsx';

export default function PasswordBanner() {
  const { auth } = useAuth();
  const { t } = useT();
  if (!auth.defaultPassword) return null;
  return (
    <div className="banner">
      {t('password_banner.message')} <Link to="/settings/seguridad">{t('password_banner.link')}</Link>
    </div>
  );
}
