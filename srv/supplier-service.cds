using demo from '../db/schema'

service SupplierService{
    entity Applications as projection on demo.application;
}