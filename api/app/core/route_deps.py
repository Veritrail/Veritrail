"""FastAPI RBAC dependencies for route handlers."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from app.core.rbac import current_org_user, require_min_role, require_owner
from app.models.org import User

RequireViewer = Annotated[User, Depends(current_org_user)]
RequireEditor = Annotated[User, Depends(require_min_role("editor"))]
RequireAdmin = Annotated[User, Depends(require_min_role("admin"))]
RequireOwner = Annotated[User, Depends(require_owner())]
