import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function PasswordBanner() {
  const { auth } = useAuth();
  if (!auth.defaultPassword) return null;
  return (
    <div className="banner">
      Usas la contraseña predeterminada. <Link to="/settings/seguridad">Cámbiala en Ajustes → Seguridad</Link>
    </div>
  );
}
